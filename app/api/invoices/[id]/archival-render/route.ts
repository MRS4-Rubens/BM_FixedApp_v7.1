import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { invoices, invoiceLineItems } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { verifyArchivalToken } from '@/lib/security/archival-token';
import { exportLimiter, checkRateLimit, getClientIp } from '@/lib/rate-limit/upstash';
import { logError } from '@/lib/actions/_shared/logger';
import { resolveSellerDetails, toInvoicePrintFields, type SellerDetails } from '@/lib/invoices/seller-snapshot';
import { loadLogoDataUri } from '@/lib/storage/logo';
const { renderToStaticMarkup } = require('react-dom/server');
import { InvoicePrintView } from '@/components/app/invoices/invoice-print-view';
import fs from 'fs';
import path from 'path';

function getCompiledCss(): string {
  const dirs = [
    path.join(process.cwd(), '.next', 'static', 'css'),
    path.join(process.cwd(), '.next', 'static', 'chunks'),
  ];
  const chunks: string[] = [];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.css'));
      for (const f of files) {
        chunks.push(fs.readFileSync(path.join(dir, f), 'utf8'));
      }
    } catch {
      // Ignore missing build subdirectories in dev
    }
  }
  return chunks.join('\n');
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { valid, invoiceId } = verifyArchivalToken(token);
  if (!valid || invoiceId !== id) {
    return new Response('Unauthorized', { status: 401 });
  }

  const ip = getClientIp(request.headers);
  const { allowed, retryAfterSeconds } = await checkRateLimit(exportLimiter, `archival-render:${ip}`);
  if (!allowed) {
    return new Response(`Too Many Requests. Retry after ${retryAfterSeconds} seconds.`, {
      status: 429,
      headers: { 'Retry-After': retryAfterSeconds.toString() }
    });
  }

  // Fetch the invoice (verified finalized)
  const existing = await db.select().from(invoices).where(eq(invoices.id, id));
  if (existing.length === 0) return new Response('Not Found', { status: 404 });
  const invoice = existing[0];
  
  if (invoice.lifecycle_status !== 'finalized') {
    return new Response('Invoice not finalized', { status: 400 });
  }

  const lineItems = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoice_id, id)).orderBy(invoiceLineItems.sort_order);

  let seller: SellerDetails;
  try {
    seller = resolveSellerDetails(invoice, null);
  } catch (error: unknown) {
    logError('archival-render', error, { invoiceId: id });
    return new Response('Seller snapshot unavailable', { status: 500 });
  }

  const logoBase64 = seller.logoStorageKey ? await loadLogoDataUri(seller.logoStorageKey) : null;
  const invoiceData = { ...invoice, ...toInvoicePrintFields(seller), logo_base64: logoBase64, lineItems };
  const css = getCompiledCss();

  const printViewElement = InvoicePrintView({
    invoice: invoiceData,
    businessStateCode: seller.stateCode,
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Invoice ${invoice.invoice_number}</title>
  <style>
    ${css}
    /* Force print styles for the standalone render to ensure we capture the print layout */
    @media all {
      body { background-color: white; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
      .print\\:hidden { display: none !important; }
      .print\\:block { display: block !important; }
      .print\\:p-0 { padding: 0 !important; }
      .print\\:border-none { border: none !important; }
      .print\\:shadow-none { box-shadow: none !important; }
      .print\\:rounded-none { border-radius: 0 !important; }
    }
  </style>
</head>
<body class="antialiased font-sans">
  ${renderToStaticMarkup(printViewElement)}
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8'
    }
  });
}
