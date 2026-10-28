import { and, eq } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import type { DbTransaction } from '@/lib/db/client';
import { auditLog, payments } from '@/lib/db/schema';
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
  readonly input: RecordPaymentInput;
  readonly todayIst?: string;
}

export interface RecordPaymentTxResult {
  readonly payment_status: PaymentStatus;
  readonly remaining_balance_paise: number;
}

export async function recordPaymentInTransaction(
  tx: DbTransaction,
  params: RecordPaymentTxParams,
): Promise<RecordPaymentTxResult> {
  const { businessId, input } = params;

  // 1. Fail fast lock timeout
  await setLocalLockTimeout(tx);

  // 2. Lock finalized invoice (Lock order: invoice row first)
  const invoice = await lockFinalizedInvoice(
    tx,
    { id: input.invoice_id, businessId },
    {
      notFound: 'Invoice not found.',
      notFinalized: 'Payments can only be recorded against finalized invoices.',
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
    throw new ActionError('Enter a valid payment date.', { code: 'INVALID_DATE' });
  }

  const today = params.todayIst ?? formatIstDateAsIso(new Date());
  if (input.payment_date > today) {
    throw new ActionError('Payment date cannot be in the future.', { code: 'INVALID_DATE' });
  }

  if (invoice.invoice_date && input.payment_date < invoice.invoice_date) {
    const [iY, iM, iD] = invoice.invoice_date.slice(0, 10).split('-');
    const formattedInvoiceDate = `${iD}/${iM}/${iY}`;
    throw new ActionError(`Payment date cannot be before the invoice date (${formattedInvoiceDate}).`, {
      code: 'INVALID_DATE',
    });
  }

  // 5. Query stable invoice balance under row lock and check overpayment
  const balance = await loadInvoiceBalance(tx, invoice);
  if (amountPaise > balance.remainingPaise) {
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
  await tx.insert(payments).values({
    business_id: businessId,
    invoice_id: invoice.id,
    amount_paise: amountPaise,
    payment_date: input.payment_date,
    payment_method: input.payment_method,
    reference_number: input.reference_number || null,
    notes: input.notes || null,
  });

  // 7. Recompute and persist payment_status
  const after = await recomputePaymentStatus(tx, invoice);

  return {
    payment_status: after.status,
    remaining_balance_paise: after.remainingPaise,
  };
}

export interface VoidPaymentTxParams {
  readonly businessId: string;
  readonly userId: string;
  readonly operatorDisplayName: string | null | undefined;
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
  const { businessId, userId, operatorDisplayName, input } = params;

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
  await tx.insert(auditLog).values({
    business_id: businessId,
    user_id: userId,
    entity_type: 'payment',
    entity_id: payment.id,
    action: 'void',
    metadata: {
      amount_paise: payment.amount_paise,
      payment_date: payment.payment_date,
      payment_method: payment.payment_method,
      reference_number: payment.reference_number,
      reason: input.reason,
      notes: input.notes,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      operator_display_name: operatorDisplayName,
      voided_at: voidedAt.toISOString(),
    },
  });

  // 7. Recompute and persist invoice payment_status
  const after = await recomputePaymentStatus(tx, invoice);

  return {
    success: true,
    voidedPaymentId: payment.id,
    newPaymentStatus: after.status,
    activeTotalPaise: after.activePaidPaise,
    invoiceId: invoice.id,
  };
}

