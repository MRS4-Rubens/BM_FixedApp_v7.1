import { and, eq, min } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import { writeAudit, type AuditRequestContext } from '@/lib/audit/log';
import type { DbTransaction } from '@/lib/db/client';
import { creditNotes, payments } from '@/lib/db/schema';
import { setLocalLockTimeout } from '@/lib/db/transaction';
import { formatIstDateAsIso, isValidIsoDate } from '@/lib/invoices/ist-date';
import { lockFinalizedInvoice, lockPayment } from '@/lib/invoices/document-locks';
import { formatPaiseAsInr, parseRupeesToPaise } from '@/lib/money';
import {
  loadInvoiceBalance,
  recomputePaymentStatus,
  type PaymentStatus,
} from '@/lib/invoices/payment-status';
import type { RecordPaymentInput, VoidPaymentInput } from '@/lib/validations/payment';

export interface RecordPaymentTxParams {
  readonly businessId: string;
  readonly actorUserId: string | null;
  readonly requestContext: AuditRequestContext;
  readonly input: RecordPaymentInput;
  readonly todayIst?: string;
}

export interface RecordPaymentTxResult {
  readonly payment_status: PaymentStatus;
  readonly remaining_balance_paise: number;
  /** Still owed back to the customer after this entry. */
  readonly refund_due_paise: number;
}

export async function recordPaymentInTransaction(
  tx: DbTransaction,
  params: RecordPaymentTxParams,
): Promise<RecordPaymentTxResult> {
  const { businessId, actorUserId, requestContext, input } = params;
  const isRefund = input.kind === 'refund';
  const word = isRefund ? 'Refund' : 'Payment';

  // 1. Fail fast lock timeout
  await setLocalLockTimeout(tx);

  // 2. Lock finalized invoice (Lock order: invoice row first)
  const invoice = await lockFinalizedInvoice(
    tx,
    { id: input.invoice_id, businessId },
    {
      notFound: 'Invoice not found.',
      notFinalized: `${word}s can only be recorded against finalized invoices.`,
    },
  );

  // 3. Exact rupee-to-paise conversion
  const amountPaise = parseRupeesToPaise(input.amount);
  if (amountPaise === null || amountPaise < 1) {
    throw new ActionError('Enter a valid amount of at least ₹0.01 with at most 2 decimal places.', {
      code: 'INVALID_AMOUNT',
    });
  }

  // 4. Strict calendar date validation
  if (!isValidIsoDate(input.payment_date)) {
    throw new ActionError(`Enter a valid ${word.toLowerCase()} date.`, { code: 'INVALID_DATE' });
  }

  const today = params.todayIst ?? formatIstDateAsIso(new Date());
  if (input.payment_date > today) {
    throw new ActionError(`${word} date cannot be in the future.`, { code: 'INVALID_DATE' });
  }

  if (invoice.invoice_date && input.payment_date < invoice.invoice_date) {
    const [iY, iM, iD] = invoice.invoice_date.slice(0, 10).split('-');
    const formattedInvoiceDate = `${iD}/${iM}/${iY}`;
    throw new ActionError(`${word} date cannot be before the invoice date (${formattedInvoiceDate}).`, {
      code: 'INVALID_DATE',
    });
  }

  // 5. Query stable invoice balance under row lock and check the amount
  const balance = await loadInvoiceBalance(tx, invoice);
  if (isRefund) {
    // A refund only returns an overpayment, which exists only after a credit note reduced the bill.
    if (balance.refundDuePaise === 0) {
      throw new ActionError('There is no refund due on this invoice.', { code: 'NO_REFUND_DUE' });
    }
    if (amountPaise > balance.refundDuePaise) {
      throw new ActionError(
        `This refund of ${formatPaiseAsInr(amountPaise)} is more than the refund due of ${formatPaiseAsInr(balance.refundDuePaise)}. Enter an amount up to the refund due.`,
        { code: 'OVER_REFUND' },
      );
    }
    // Money cannot go back before the credit note that created the refund due.
    const [firstCredit] = await tx
      .select({ date: min(creditNotes.issue_date) })
      .from(creditNotes)
      .where(
        and(
          eq(creditNotes.original_invoice_id, invoice.id),
          eq(creditNotes.business_id, businessId),
          eq(creditNotes.lifecycle_status, 'finalized'),
          eq(creditNotes.status, 'active'),
        ),
      );
    const firstCreditDate = firstCredit?.date ? String(firstCredit.date).slice(0, 10) : null;
    if (firstCreditDate && input.payment_date < firstCreditDate) {
      const [cY, cM, cD] = firstCreditDate.split('-');
      throw new ActionError(`Refund date cannot be before the credit note date (${cD}/${cM}/${cY}).`, {
        code: 'INVALID_DATE',
      });
    }
  } else if (amountPaise > balance.remainingPaise) {
    if (balance.remainingPaise === 0) {
      throw new ActionError('This invoice has no remaining balance.', { code: 'OVERPAYMENT' });
    }
    const adjustedText =
      balance.totalCreditedPaise > 0
        ? ` (adjusted for ${formatPaiseAsInr(balance.totalCreditedPaise)} in credit notes)`
        : '';
    throw new ActionError(
      `This payment of ${formatPaiseAsInr(amountPaise)} would exceed the invoice's remaining balance of ${formatPaiseAsInr(balance.remainingPaise)}${adjustedText}. Enter an amount up to the remaining balance.`,
      { code: 'OVERPAYMENT' },
    );
  }

  // 6. Insert payment
  const [inserted] = await tx
    .insert(payments)
    .values({
      business_id: businessId,
      invoice_id: invoice.id,
      kind: isRefund ? 'refund' : 'payment',
      amount_paise: amountPaise,
      payment_date: input.payment_date,
      payment_method: input.payment_method,
      reference_number: input.reference_number || null,
      notes: input.notes || null,
    })
    .returning({ id: payments.id });

  if (!inserted) {
    throw new ActionError(`Failed to record ${word.toLowerCase()}.`, { code: 'INTERNAL_ERROR' });
  }

  // 7. Recompute and persist payment_status
  const after = await recomputePaymentStatus(tx, invoice);

  // 8. Log in statutory audit log (separate literal actions: the audit-coverage scan checks each pair)
  const auditMetadata = {
    kind: isRefund ? 'refund' : 'payment',
    amount_paise: amountPaise,
    payment_date: input.payment_date,
    payment_method: input.payment_method,
    reference_number: input.reference_number || null,
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    resulting_payment_status: after.status,
    resulting_refund_due_paise: after.refundDuePaise,
  };
  if (isRefund) {
    await writeAudit(tx, {
      businessId,
      actorUserId,
      entityType: 'payment',
      entityId: inserted.id,
      action: 'record_refund',
      requestContext,
      metadata: auditMetadata,
    });
  } else {
    await writeAudit(tx, {
      businessId,
      actorUserId,
      entityType: 'payment',
      entityId: inserted.id,
      action: 'record',
      requestContext,
      metadata: auditMetadata,
    });
  }

  return {
    payment_status: after.status,
    remaining_balance_paise: after.remainingPaise,
    refund_due_paise: after.refundDuePaise,
  };
}

export interface VoidPaymentTxParams {
  readonly businessId: string;
  readonly userId: string;
  readonly operatorDisplayName: string | null | undefined;
  readonly requestContext: AuditRequestContext;
  readonly input: VoidPaymentInput;
  readonly now?: Date;
}

export interface VoidPaymentTxResult {
  readonly success: true;
  readonly voidedPaymentId: string;
  readonly newPaymentStatus: PaymentStatus;
  readonly activeTotalPaise: number;
  readonly invoiceId: string;
}

export async function voidPaymentInTransaction(
  tx: DbTransaction,
  params: VoidPaymentTxParams,
): Promise<VoidPaymentTxResult> {
  const { businessId, userId, operatorDisplayName, requestContext, input } = params;

  // 1. Fail fast lock timeout
  await setLocalLockTimeout(tx);

  // 2. PEEK payment without locking to obtain associated invoice_id
  const peekRows = await tx
    .select({ id: payments.id, invoice_id: payments.invoice_id })
    .from(payments)
    .where(and(eq(payments.id, input.id), eq(payments.business_id, businessId)));

  if (peekRows.length === 0) {
    throw new ActionError('Payment record not found.', { code: 'NOT_FOUND' });
  }

  const peek = peekRows[0];

  // 3. Lock associated invoice FOR UPDATE (invoice row before payment row)
  const invoice = await lockFinalizedInvoice(
    tx,
    { id: peek.invoice_id, businessId },
    {
      notFound: 'Associated invoice not found.',
      notFinalized: 'Associated invoice is not finalized.',
    },
  );

  // 4. Lock payment row FOR UPDATE
  const payment = await lockPayment(tx, { id: input.id, businessId });

  if (payment.invoice_id !== peek.invoice_id) {
    throw new ActionError('This payment changed while voiding. Please refresh and try again.', {
      code: 'CONFLICT',
    });
  }

  // 5. Guarded update: status must be 'active'
  const voidedAt = params.now ?? new Date();
  const updated = await tx
    .update(payments)
    .set({
      status: 'voided',
      voided_at: voidedAt,
      voided_by: userId,
      void_reason: input.reason,
      void_notes: input.notes,
    })
    .where(
      and(
        eq(payments.id, payment.id),
        eq(payments.business_id, businessId),
        eq(payments.status, 'active'),
      ),
    )
    .returning({ id: payments.id });

  if (updated.length !== 1) {
    throw new ActionError('This payment record has already been voided.', { code: 'ALREADY_VOIDED' });
  }

  // 6. Log in statutory audit log
  await writeAudit(tx, {
    businessId,
    actorUserId: userId,
    entityType: 'payment',
    entityId: payment.id,
    action: 'void',
    requestContext,
    metadata: {
      kind: payment.kind,
      amount_paise: payment.amount_paise,
      payment_date: payment.payment_date,
      payment_method: payment.payment_method,
      reference_number: payment.reference_number ?? null,
      reason: input.reason,
      notes: input.notes ?? null,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      operator_display_name: operatorDisplayName ?? null,
      voided_at: voidedAt.toISOString(),
    },
  });

  // 7. Recompute and persist invoice payment_status. Voiding a PAYMENT that a refund depends on is refused here
  //    (refunds may never exceed the money kept); voiding a refund always passes.
  const after = await recomputePaymentStatus(tx, invoice, {
    refundNotCoveredMessage:
      'Voiding this payment would leave more refunded to the customer than they paid. Void the refund entry first, then void this payment.',
  });

  return {
    success: true,
    voidedPaymentId: payment.id,
    newPaymentStatus: after.status,
    activeTotalPaise: after.activePaidPaise,
    invoiceId: invoice.id,
  };
}
