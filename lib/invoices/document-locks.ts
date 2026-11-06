/**
 * LOCK-ORDER CONTRACT: invoice row -> credit-note row -> payment row -> financial_years row -> invoice_number_counters row.
 * Never acquire an earlier lock after a later one in the same transaction.
 * Draft-save actions lock only the document they edit.
 */

import { and, eq } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import type { DbTransaction } from '@/lib/db/client';
import { creditNotes, invoices, payments } from '@/lib/db/schema';

export type InvoiceRow = typeof invoices.$inferSelect;
export type CreditNoteRow = typeof creditNotes.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;

export interface DraftLockMessages {
  readonly alreadyFinalized?: string;
}

export interface FinalizedInvoiceLockMessages {
  readonly notFound?: string;
  readonly notFinalized?: string;
}

export async function lockDraftInvoice(
  tx: DbTransaction,
  ids: { readonly id: string; readonly businessId: string },
  messages?: DraftLockMessages,
): Promise<InvoiceRow> {
  const rows = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, ids.id), eq(invoices.business_id, ids.businessId)))
    .for('update');

  const row = rows[0];
  if (!row) {
    throw new ActionError('Invoice not found.', { code: 'NOT_FOUND' });
  }

  if (row.lifecycle_status !== 'draft') {
    throw new ActionError(
      messages?.alreadyFinalized ?? 'This invoice has already been finalized.',
      { code: 'ALREADY_FINALIZED' },
    );
  }

  return row;
}

export async function lockFinalizedInvoice(
  tx: DbTransaction,
  ids: { readonly id: string; readonly businessId: string },
  messages?: FinalizedInvoiceLockMessages,
): Promise<InvoiceRow> {
  const rows = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, ids.id), eq(invoices.business_id, ids.businessId)))
    .for('update');

  const row = rows[0];
  if (!row) {
    throw new ActionError(messages?.notFound ?? 'Original invoice not found.', { code: 'NOT_FOUND' });
  }

  if (row.lifecycle_status !== 'finalized') {
    throw new ActionError(messages?.notFinalized ?? 'Original invoice is not finalized.', { code: 'INVALID_STATUS' });
  }

  return row;
}

export async function lockDraftCreditNote(
  tx: DbTransaction,
  ids: { readonly id: string; readonly businessId: string },
  messages?: DraftLockMessages,
): Promise<CreditNoteRow> {
  const rows = await tx
    .select()
    .from(creditNotes)
    .where(and(eq(creditNotes.id, ids.id), eq(creditNotes.business_id, ids.businessId)))
    .for('update');

  const row = rows[0];
  if (!row) {
    throw new ActionError('Credit note not found.', { code: 'NOT_FOUND' });
  }

  if (row.lifecycle_status !== 'draft') {
    throw new ActionError(
      messages?.alreadyFinalized ?? 'This credit note has already been finalized and locked.',
      { code: 'ALREADY_FINALIZED' },
    );
  }

  if (row.status !== 'active') {
    throw new ActionError('This credit note is no longer active.', { code: 'INVALID_STATUS' });
  }

  return row;
}

export async function lockFinalizedCreditNote(
  tx: DbTransaction,
  ids: { readonly id: string; readonly businessId: string },
): Promise<CreditNoteRow> {
  const rows = await tx
    .select()
    .from(creditNotes)
    .where(and(eq(creditNotes.id, ids.id), eq(creditNotes.business_id, ids.businessId)))
    .for('update');

  const row = rows[0];
  if (!row) {
    throw new ActionError('Credit note not found.', { code: 'NOT_FOUND' });
  }

  if (row.lifecycle_status !== 'finalized') {
    throw new ActionError('Only finalized credit notes can be voided. Drafts can be deleted directly.', {
      code: 'INVALID_STATUS',
    });
  }

  if (row.status === 'voided') {
    throw new ActionError('This credit note has already been voided.', { code: 'ALREADY_VOIDED' });
  }

  return row;
}

export async function lockPayment(
  tx: DbTransaction,
  ids: { readonly id: string; readonly businessId: string },
): Promise<PaymentRow> {
  const rows = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.id, ids.id), eq(payments.business_id, ids.businessId)))
    .for('update');

  const row = rows[0];
  if (!row) {
    throw new ActionError('Payment record not found.', { code: 'NOT_FOUND' });
  }

  if (row.status === 'voided') {
    throw new ActionError('This payment record has already been voided.', { code: 'ALREADY_VOIDED' });
  }

  return row;
}
