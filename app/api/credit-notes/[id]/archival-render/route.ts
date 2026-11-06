import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server.edge';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { creditNotes, creditNoteLineItems, invoices } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { archivalResponse, authorizeArchivalRequest } from '@/lib/security/archival-route-guard';
import { logError } from '@/lib/actions/_shared/logger';
import { resolveSellerDetails, toCreditNotePrintBusiness, type SellerDetails } from '@/lib/invoices/seller-snapshot';
import { loadLogoDataUri } from '@/lib/storage/logo';
import { CreditNotePrintView, CreditNotePrintViewProps } from '@/components/app/credit-notes/credit-note-print-view';
import { buildArchivalHtmlDocument } from '@/lib/pdf/archival-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeArchivalRequest(request, 'credit_note', id);
  if (!auth.ok) return auth.response;

  // Fetch the credit note (verified finalized)
  const cnRows = await db.select().from(creditNotes).where(eq(creditNotes.id, id));
  if (cnRows.length === 0) return archivalResponse('Not Found', { status: 404 });
  const creditNote = cnRows[0];

  if (creditNote.lifecycle_status !== 'finalized') {
    return archivalResponse('Credit note not finalized', { status: 400 });
  }

  const invRows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, creditNote.original_invoice_id), eq(invoices.business_id, creditNote.business_id)));
  if (invRows.length === 0) return archivalResponse('Original Invoice Not Found', { status: 404 });
  const originalInvoice = invRows[0];

  const lineItems = await db
    .select()
    .from(creditNoteLineItems)
    .where(eq(creditNoteLineItems.credit_note_id, id))
    .orderBy(creditNoteLineItems.sort_order);

  let seller: SellerDetails;
  try {
    seller = resolveSellerDetails(creditNote, null);
  } catch (error: unknown) {
    logError('archival-render', error, { creditNoteId: id });
    return archivalResponse('Seller snapshot unavailable', { status: 500 });
  }

  const logoBase64 = seller.logoStorageKey ? await loadLogoDataUri(seller.logoStorageKey) : null;

  const printData = {
    ...creditNote,
    business: {
      ...toCreditNotePrintBusiness(seller, creditNote.business_id),
      logo_base64: logoBase64,
    },
    originalInvoice,
    lineItems,
  };

  const extraCss = `@page { size: A4 portrait; margin: 0; }
    body { margin: 0; padding: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }`;

  const bodyHtml = renderToStaticMarkup(
    createElement(CreditNotePrintView, {
      creditNote: printData as unknown as CreditNotePrintViewProps['creditNote'],
      printSize: 'A4',
    }),
  );

  const html = buildArchivalHtmlDocument({
    title: `Credit Note ${creditNote.credit_note_number}`,
    bodyHtml,
    extraCss,
  });

  return archivalResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}
