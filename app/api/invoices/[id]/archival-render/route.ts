import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server.edge';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { invoices, invoiceLineItems } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { archivalResponse, authorizeArchivalRequest } from '@/lib/security/archival-route-guard';
import { logError } from '@/lib/actions/_shared/logger';
import { resolveSellerDetails, toInvoicePrintFields, type SellerDetails } from '@/lib/invoices/seller-snapshot';
import { loadLogoDataUri } from '@/lib/storage/logo';
import { InvoicePrintView } from '@/components/app/invoices/invoice-print-view';
import { buildArchivalHtmlDocument } from '@/lib/pdf/archival-html';
import { resolveFinalizedDisplayPrefs } from '@/lib/invoices/display-prefs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeArchivalRequest(request, 'invoice', id);
  if (!auth.ok) return auth.response;

  // Fetch the invoice (verified finalized)
  const existing = await db.select().from(invoices).where(eq(invoices.id, id));
  if (existing.length === 0) return archivalResponse('Not Found', { status: 404 });
  const invoice = existing[0];

  if (invoice.lifecycle_status !== 'finalized') {
    return archivalResponse('Invoice not finalized', { status: 400 });
  }

  const lineItems = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoice_id, id))
    .orderBy(invoiceLineItems.sort_order);

  let seller: SellerDetails;
  try {
    seller = resolveSellerDetails(invoice, null);
  } catch (error: unknown) {
    logError('archival-render', error, { invoiceId: id });
    return archivalResponse('Seller snapshot unavailable', { status: 500 });
  }

  const logoBase64 = seller.logoStorageKey ? await loadLogoDataUri(seller.logoStorageKey) : null;
  const invoiceData = { ...invoice, ...toInvoicePrintFields(seller), logo_base64: logoBase64, lineItems };

  const extraCss = `/* Force print styles for the standalone render to ensure we capture the print layout */
    @media all {
      body { background-color: white; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
      .print\\:hidden { display: none !important; }
      .print\\:block { display: block !important; }
      .print\\:p-0 { padding: 0 !important; }
      .print\\:border-none { border: none !important; }
      .print\\:shadow-none { box-shadow: none !important; }
      .print\\:rounded-none { border-radius: 0 !important; }
    }`;

  const displayPrefs = resolveFinalizedDisplayPrefs(invoice.display_prefs_snapshot);

  const bodyHtml = renderToStaticMarkup(
    createElement(InvoicePrintView, {
      invoice: invoiceData,
      businessStateCode: seller.stateCode,
      displayPrefs,
    }),
  );

  const html = buildArchivalHtmlDocument({
    title: `Invoice ${invoice.invoice_number}`,
    bodyHtml,
    extraCss,
    bodyClass: 'antialiased font-sans',
  });

  return archivalResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}
