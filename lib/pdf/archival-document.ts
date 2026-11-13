import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server.edge';
import { db } from '@/lib/db/client';
import { invoices, invoiceLineItems, creditNotes, creditNoteLineItems } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { logError } from '@/lib/actions/_shared/logger';
import {
  resolveSellerDetails,
  toInvoicePrintFields,
  toCreditNotePrintBusiness,
  type SellerDetails,
} from '@/lib/invoices/seller-snapshot';
import { loadLogoDataUri } from '@/lib/storage/logo';
import { loadSignatureDataUri } from '@/lib/storage/signature';
import { InvoicePrintView } from '@/components/app/invoices/invoice-print-view';
import {
  CreditNotePrintView,
  type CreditNotePrintViewProps,
} from '@/components/app/credit-notes/credit-note-print-view';
import { buildArchivalHtmlDocument } from '@/lib/pdf/archival-html';
import { resolveFinalizedDisplayPrefs } from '@/lib/invoices/display-prefs';
import type { ArchivalKind } from '@/lib/storage/archival-config';

export type ArchivalDocumentFailure =
  | 'not_found'
  | 'not_finalized'
  | 'original_invoice_not_found'
  | 'seller_snapshot_unavailable';

export class ArchivalDocumentError extends Error {
  readonly failure: ArchivalDocumentFailure;
  constructor(readonly reason: ArchivalDocumentFailure, message: string) {
    super(message);
    this.name = 'ArchivalDocumentError';
    this.failure = reason;
  }
}

async function buildInvoiceArchivalHtml(id: string): Promise<{ html: string; title: string }> {
  const existing = await db.select().from(invoices).where(eq(invoices.id, id));
  if (existing.length === 0) {
    throw new ArchivalDocumentError('not_found', 'Not Found');
  }
  const invoice = existing[0];

  if (invoice.lifecycle_status !== 'finalized') {
    throw new ArchivalDocumentError('not_finalized', 'Invoice not finalized');
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
    throw new ArchivalDocumentError('seller_snapshot_unavailable', 'Seller snapshot unavailable');
  }

  const logoBase64 = seller.logoStorageKey ? await loadLogoDataUri(seller.logoStorageKey) : null;
  const signatureDataUri = seller.signatureStorageKey ? await loadSignatureDataUri(seller.signatureStorageKey) : null;
  const invoiceData = { ...invoice, ...toInvoicePrintFields(seller), logo_base64: logoBase64, signature_data_uri: signatureDataUri, lineItems };

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

  const title = `Invoice ${invoice.invoice_number}`;
  const html = buildArchivalHtmlDocument({
    title,
    bodyHtml,
    extraCss,
    bodyClass: 'antialiased font-sans',
  });

  return { html, title };
}

async function buildCreditNoteArchivalHtml(id: string): Promise<{ html: string; title: string }> {
  const cnRows = await db.select().from(creditNotes).where(eq(creditNotes.id, id));
  if (cnRows.length === 0) {
    throw new ArchivalDocumentError('not_found', 'Not Found');
  }
  const creditNote = cnRows[0];

  if (creditNote.lifecycle_status !== 'finalized') {
    throw new ArchivalDocumentError('not_finalized', 'Credit note not finalized');
  }

  const invRows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, creditNote.original_invoice_id), eq(invoices.business_id, creditNote.business_id)));
  if (invRows.length === 0) {
    throw new ArchivalDocumentError('original_invoice_not_found', 'Original Invoice Not Found');
  }
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
    throw new ArchivalDocumentError('seller_snapshot_unavailable', 'Seller snapshot unavailable');
  }

  const logoBase64 = seller.logoStorageKey ? await loadLogoDataUri(seller.logoStorageKey) : null;
  const signatureDataUri = seller.signatureStorageKey ? await loadSignatureDataUri(seller.signatureStorageKey) : null;

  const printData = {
    ...creditNote,
    business: {
      ...toCreditNotePrintBusiness(seller, creditNote.business_id),
      logo_base64: logoBase64,
      signature_data_uri: signatureDataUri,
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

  const title = `Credit Note ${creditNote.credit_note_number}`;
  const html = buildArchivalHtmlDocument({
    title,
    bodyHtml,
    extraCss,
  });

  return { html, title };
}

export async function buildArchivalHtml(kind: ArchivalKind, id: string): Promise<{ html: string; title: string }> {
  if (kind === 'invoice') {
    return buildInvoiceArchivalHtml(id);
  }
  return buildCreditNoteArchivalHtml(id);
}

