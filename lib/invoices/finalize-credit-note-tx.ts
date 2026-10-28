import { and, eq, sql } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import type { DbTransaction } from '@/lib/db/client';
import { businesses, creditNoteLineItems, creditNotes, invoices, payments } from '@/lib/db/schema';
import { setLocalLockTimeout } from '@/lib/db/transaction';
import { lockDraftCreditNote, lockFinalizedInvoice } from '@/lib/invoices/document-locks';
import { getNextCreditNoteNumber } from '@/lib/invoices/credit-note-numbering';
import { getOrCreateCurrentFinancialYear } from '@/lib/invoices/financial-year-rollover';
import { formatIstDateAsIso, parseIsoDateToIstDate } from '@/lib/invoices/ist-date';

export interface FinalizeCreditNoteTxParams {
  readonly creditNoteId: string;
  readonly businessId: string;
}

export interface FinalizeCreditNoteTxResult {
  readonly id: string;
  readonly creditNoteNumber: string;
  readonly originalInvoiceId: string;
}

export async function finalizeDraftCreditNoteInTransaction(
  tx: DbTransaction,
  params: FinalizeCreditNoteTxParams,
): Promise<FinalizeCreditNoteTxResult> {
  // 1. Fail-fast lock timeout
  await setLocalLockTimeout(tx);

  // 2. PEEK (no lock) to find the original invoice ID
  const peekRows = await tx
    .select({ original_invoice_id: creditNotes.original_invoice_id })
    .from(creditNotes)
    .where(and(eq(creditNotes.id, params.creditNoteId), eq(creditNotes.business_id, params.businessId)));

  if (peekRows.length === 0) {
    throw new ActionError('Credit note not found.', { code: 'NOT_FOUND' });
  }

  const peekedOriginalInvoiceId = peekRows[0].original_invoice_id;

  // 3. Lock original finalized invoice (Lock order: invoice row first)
  const originalInvoice = await lockFinalizedInvoice(tx, {
    id: peekedOriginalInvoiceId,
    businessId: params.businessId,
  });

  // 4. Lock draft credit note (Lock order: credit note row second)
  const creditNote = await lockDraftCreditNote(tx, {
    id: params.creditNoteId,
    businessId: params.businessId,
  });

  if (creditNote.original_invoice_id !== peekedOriginalInvoiceId) {
    throw new ActionError(
      'This credit note was modified while finalizing. Please review it and try again.',
      { code: 'CONFLICT' },
    );
  }

  // 5. Ensure credit note has line items
  const lineItemRows = await tx
    .select()
    .from(creditNoteLineItems)
    .where(eq(creditNoteLineItems.credit_note_id, creditNote.id));

  if (lineItemRows.length === 0) {
    throw new ActionError('Credit note must contain at least one line item before finalization.', { code: 'NO_ITEMS' });
  }

  // 6. Fetch business profile
  const bizRows = await tx.select().from(businesses).where(eq(businesses.id, params.businessId));
  if (bizRows.length === 0) throw new ActionError('Business not found.', { code: 'NOT_FOUND' });
  const business = bizRows[0];

  // 7. Get active financial year
  const issueDateObj = creditNote.issue_date ? parseIsoDateToIstDate(creditNote.issue_date) : new Date();
  const activeFy = await getOrCreateCurrentFinancialYear(tx, params.businessId, issueDateObj);

  // 8. Generate official, sequential Credit Note Number
  const { creditNoteNumber, sequence } = await getNextCreditNoteNumber(tx, {
    businessId: params.businessId,
    financialYearId: activeFy.id,
    fyLabel: activeFy.label,
    prefix: business.credit_note_number_prefix || 'CN',
  });

  const finalizedIssueDate = creditNote.issue_date || formatIstDateAsIso(new Date());

  // 9. Guarded update
  const updated = await tx
    .update(creditNotes)
    .set({
      credit_note_number: creditNoteNumber,
      credit_note_sequence: sequence,
      financial_year_id: activeFy.id,
      lifecycle_status: 'finalized',
      issue_date: finalizedIssueDate,
      finalized_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(creditNotes.id, creditNote.id),
        eq(creditNotes.business_id, params.businessId),
        eq(creditNotes.lifecycle_status, 'draft'),
        eq(creditNotes.status, 'active'),
      ),
    )
    .returning({ id: creditNotes.id });

  if (updated.length !== 1) {
    throw new ActionError('This credit note has already been finalized and locked.', { code: 'ALREADY_FINALIZED' });
  }

  // 10. Recalculate original invoice payment status
  // A. Sum active payments (excluding voided payments)
  const paymentsSumRes = await tx
    .select({ total: sql<number>`coalesce(sum(${payments.amount_paise}), 0)` })
    .from(payments)
    .where(
      and(
        eq(payments.invoice_id, originalInvoice.id),
        eq(payments.status, 'active'),
      ),
    );
  const totalPaidPaise = Number(paymentsSumRes[0]?.total || 0);

  // B. Sum all finalized credit notes (including this one)
  const cnSumRes = await tx
    .select({ total: sql<number>`coalesce(sum(${creditNotes.grand_total_paise}), 0)` })
    .from(creditNotes)
    .where(
      and(
        eq(creditNotes.original_invoice_id, originalInvoice.id),
        eq(creditNotes.lifecycle_status, 'finalized'),
        eq(creditNotes.status, 'active'),
      ),
    );
  const totalCreditedPaise = Number(cnSumRes[0]?.total || 0);

  const netBillPaise = originalInvoice.grand_total_paise - totalCreditedPaise;

  let newPaymentStatus: 'unpaid' | 'partially_paid' | 'paid' = 'unpaid';
  if (totalPaidPaise >= netBillPaise && netBillPaise >= 0) {
    newPaymentStatus = 'paid';
  } else if (totalPaidPaise > 0) {
    newPaymentStatus = 'partially_paid';
  } else {
    newPaymentStatus = 'unpaid';
  }

  await tx
    .update(invoices)
    .set({
      payment_status: newPaymentStatus,
    })
    .where(eq(invoices.id, originalInvoice.id));

  return {
    id: creditNote.id,
    creditNoteNumber,
    originalInvoiceId: originalInvoice.id,
  };
}

