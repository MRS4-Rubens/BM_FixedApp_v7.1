import { and, eq, sql } from 'drizzle-orm';
import { creditNotes, invoices, payments } from '@/lib/db/schema';
import type { DbTransaction } from '@/lib/db/client';
import { computeNetBillPaise, computePaymentStatus, type PaymentStatus } from './settlement';

export { computeNetBillPaise, computePaymentStatus, type PaymentStatus } from './settlement';

export interface InvoiceBalance {
  readonly netBillPaise: number;
  readonly totalCreditedPaise: number;
  readonly activePaidPaise: number;
  readonly remainingPaise: number;
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
    .select({ total: sql<string | number>`coalesce(sum(${payments.amount_paise}), 0)` })
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

  const activePaidPaise = toSafePaise(paid?.total);
  const totalCreditedPaise = toSafePaise(credited?.total);
  const netBillPaise = computeNetBillPaise(invoice.grand_total_paise, totalCreditedPaise);
  return {
    netBillPaise,
    totalCreditedPaise,
    activePaidPaise,
    remainingPaise: Math.max(0, netBillPaise - activePaidPaise),
  };
}

/** Recomputes and persists invoices.payment_status. Same precondition as loadInvoiceBalance. */
export async function recomputePaymentStatus(
  tx: DbTransaction,
  invoice: LockedInvoice,
): Promise<InvoiceBalance & { readonly status: PaymentStatus }> {
  const balance = await loadInvoiceBalance(tx, invoice);
  const status = computePaymentStatus(balance.netBillPaise, balance.activePaidPaise);
  const updated = await tx
    .update(invoices)
    .set({ payment_status: status })
    .where(and(eq(invoices.id, invoice.id), eq(invoices.business_id, invoice.business_id)))
    .returning({ id: invoices.id });

  if (updated.length !== 1) {
    throw new Error('Invoice payment status update affected an unexpected number of rows.');
  }

  return { ...balance, status };
}

