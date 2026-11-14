import { and, eq } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import { writeAudit, type AuditRequestContext } from '@/lib/audit/log';
import type { DbTransaction } from '@/lib/db/client';
import { creditNotes } from '@/lib/db/schema';
import { setLocalLockTimeout } from '@/lib/db/transaction';
import { lockFinalizedCreditNote, lockFinalizedInvoice } from '@/lib/invoices/document-locks';
import { recomputePaymentStatus, type PaymentStatus } from '@/lib/invoices/payment-status';
import type { VoidCreditNoteInput } from '@/lib/validations/credit-note';

export interface VoidCreditNoteTxParams {
  readonly businessId: string;
  readonly userId: string;
  readonly operatorDisplayName: string | null | undefined;
  readonly requestContext: AuditRequestContext;
  readonly input: VoidCreditNoteInput;
  readonly now?: Date;
}

export interface VoidCreditNoteTxResult {
  readonly success: true;
  readonly status: 'voided';
  readonly credit_note_number: string;
  readonly restored_amount_paise: number;
  readonly invoice_payment_status: PaymentStatus;
  readonly originalInvoiceId: string;
  readonly creditNoteId: string;
}

export async function voidCreditNoteInTransaction(
  tx: DbTransaction,
  params: VoidCreditNoteTxParams,
): Promise<VoidCreditNoteTxResult> {
  const { businessId, userId, operatorDisplayName, requestContext, input } = params;

  // 1. Fail fast lock timeout
  await setLocalLockTimeout(tx);

  // 2. PEEK credit note to find associated original_invoice_id
  const peekRows = await tx
    .select({ id: creditNotes.id, original_invoice_id: creditNotes.original_invoice_id })
    .from(creditNotes)
    .where(and(eq(creditNotes.id, input.id), eq(creditNotes.business_id, businessId)));

  if (peekRows.length === 0) {
    throw new ActionError('Credit note not found.', { code: 'NOT_FOUND' });
  }

  const peek = peekRows[0];

  // 3. Lock original invoice FOR UPDATE (invoice row before credit note row)
  const invoice = await lockFinalizedInvoice(
    tx,
    { id: peek.original_invoice_id, businessId },
    {
      notFound: 'Associated original invoice not found.',
      notFinalized: 'Associated original invoice is not finalized.',
    },
  );

  // 4. Lock credit note FOR UPDATE
  const creditNote = await lockFinalizedCreditNote(tx, { id: input.id, businessId });

  if (creditNote.original_invoice_id !== peek.original_invoice_id) {
    throw new ActionError('This credit note changed while voiding. Please refresh and try again.', {
      code: 'CONFLICT',
    });
  }

  // 5. Guarded update: status must be 'active' and lifecycle_status 'finalized'
  const voidedAt = params.now ?? new Date();
  const updated = await tx
    .update(creditNotes)
    .set({
      status: 'voided',
      voided_at: voidedAt,
      voided_by: userId,
      void_reason: input.reason,
      void_notes: input.notes || null,
    })
    .where(
      and(
        eq(creditNotes.id, creditNote.id),
        eq(creditNotes.business_id, businessId),
        eq(creditNotes.lifecycle_status, 'finalized'),
        eq(creditNotes.status, 'active'),
      ),
    )
    .returning({ id: creditNotes.id });

  if (updated.length !== 1) {
    throw new ActionError('This credit note has already been voided.', { code: 'ALREADY_VOIDED' });
  }

  // 6. Log in statutory audit log
  await writeAudit(tx, {
    businessId,
    actorUserId: userId,
    entityType: 'credit_note',
    entityId: creditNote.id,
    action: 'void',
    requestContext,
    metadata: {
      credit_note_number: creditNote.credit_note_number,
      credit_note_sequence: creditNote.credit_note_sequence,
      grand_total_paise: creditNote.grand_total_paise,
      subtotal_paise: creditNote.subtotal_paise,
      total_tax_paise: creditNote.total_tax_paise,
      reason: input.reason,
      notes: input.notes ?? null,
      original_invoice_id: invoice.id,
      original_invoice_number: invoice.invoice_number,
      operator_display_name: operatorDisplayName ?? null,
      voided_at: voidedAt.toISOString(),
    },
  });

  // 7. Recompute and persist invoice payment status after voiding the credit note
  // Voiding a credit note whose amount was already refunded would leave an unjustified refund: refused here.
  const after = await recomputePaymentStatus(tx, invoice, {
    refundNotCoveredMessage:
      "This credit note's amount has already been refunded to the customer. Void the refund entry first, then void this credit note.",
  });

  return {
    success: true,
    status: 'voided',
    credit_note_number: creditNote.credit_note_number,
    restored_amount_paise: creditNote.grand_total_paise,
    invoice_payment_status: after.status,
    originalInvoiceId: invoice.id,
    creditNoteId: creditNote.id,
  };
}
