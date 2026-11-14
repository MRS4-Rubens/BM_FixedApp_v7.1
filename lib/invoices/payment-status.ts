import { and, eq, sql } from 'drizzle-orm';
import { creditNotes, invoices, payments } from '@/lib/db/schema';
import type { DbTransaction } from '@/lib/db/client';
import { ActionError } from '@/lib/actions/_shared/errors';
import {
  computeNetBillPaise,
  computePaymentStatus,
  computeRefundDuePaise,
  refundsExceedOverpayment,
  type PaymentStatus,
} from './settlement';

export { computeNetBillPaise, computePaymentStatus, type PaymentStatus } from './settlement';

export interface InvoiceBalance {
  readonly netBillPaise: number;
  readonly totalCreditedPaise: number;
  /** Active money received from the customer. */
  readonly receivedPaise: number;
  /** Active money paid back to the customer. */
  readonly refundedPaise: number;
  /** NET kept = received − refunded. Settles the bill. */
  readonly activePaidPaise: number;
  /** Still owed BY the customer. */
  readonly remainingPaise: number;
  /** Owed back TO the customer. */
  readonly refundDuePaise: number;
}

function toSafePaise(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Unexpected aggregate value while computing invoice balance.');
  }
  return parsed;
}

export type LockedInvoice = {
  readonly id: string;
  readonly business_id: string;
  readonly grand_total_paise: number;
};

/** PRECONDITION: the caller holds the invoice row lock (lockFinalizedInvoice) so these sums cannot change concurrently. */
export async function loadInvoiceBalance(tx: DbTransaction, invoice: LockedInvoice): Promise<InvoiceBalance> {
  const [paid] = await tx
    .select({
      received: sql<string | number>`coalesce(sum(${payments.amount_paise}) filter (where ${payments.kind} = 'payment'), 0)`,
      refunded: sql<string | number>`coalesce(sum(${payments.amount_paise}) filter (where ${payments.kind} = 'refund'), 0)`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.invoice_id, invoice.id),
        eq(payments.business_id, invoice.business_id),
        eq(payments.status, 'active'),
      ),
    );

  const [credited] = await tx
    .select({ total: sql<string | number>`coalesce(sum(${creditNotes.grand_total_paise}), 0)` })
    .from(creditNotes)
    .where(
      and(
        eq(creditNotes.original_invoice_id, invoice.id),
        eq(creditNotes.business_id, invoice.business_id),
        eq(creditNotes.lifecycle_status, 'finalized'),
        eq(creditNotes.status, 'active'),
      ),
    );

  const receivedPaise = toSafePaise(paid?.received);
  const refundedPaise = toSafePaise(paid?.refunded);
  const activePaidPaise = receivedPaise - refundedPaise;
  const totalCreditedPaise = toSafePaise(credited?.total);
  const netBillPaise = computeNetBillPaise(invoice.grand_total_paise, totalCreditedPaise);
  return {
    netBillPaise,
    totalCreditedPaise,
    receivedPaise,
    refundedPaise,
    activePaidPaise,
    remainingPaise: Math.max(0, netBillPaise - activePaidPaise),
    refundDuePaise: computeRefundDuePaise(netBillPaise, activePaidPaise),
  };
}

/** Shown when a change would leave more refunded than was ever overpaid (see refundsExceedOverpayment). */
const REFUND_NOT_COVERED_MESSAGE =
  'This would leave more refunded to the customer than they overpaid. Void the refund entry first, then try again.';

/**
 * Recomputes and persists invoices.payment_status AND refund_due_paise. Same precondition as loadInvoiceBalance.
 * Also enforces the refund rule after EVERY money change (record payment/refund, void payment/refund, finalize or
 * void credit note): if refunds would exceed the overpayment, it throws and the whole transaction rolls back.
 */
export async function recomputePaymentStatus(
  tx: DbTransaction,
  invoice: LockedInvoice,
  options: { readonly refundNotCoveredMessage?: string } = {},
): Promise<InvoiceBalance & { readonly status: PaymentStatus }> {
  const balance = await loadInvoiceBalance(tx, invoice);
  if (refundsExceedOverpayment(balance.netBillPaise, balance.receivedPaise, balance.refundedPaise)) {
    throw new ActionError(options.refundNotCoveredMessage ?? REFUND_NOT_COVERED_MESSAGE, { code: 'REFUND_NOT_COVERED' });
  }
  const status = computePaymentStatus(balance.netBillPaise, balance.activePaidPaise);
  const updated = await tx
    .update(invoices)
    .set({ payment_status: status, refund_due_paise: balance.refundDuePaise })
    .where(and(eq(invoices.id, invoice.id), eq(invoices.business_id, invoice.business_id)))
    .returning({ id: invoices.id });

  if (updated.length !== 1) {
    throw new Error('Invoice payment status update affected an unexpected number of rows.');
  }

  return { ...balance, status };
}

