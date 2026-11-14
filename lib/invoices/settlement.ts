export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid';

export function computeNetBillPaise(grandTotalPaise: number, totalCreditedPaise: number): number {
  return Math.max(0, grandTotalPaise - totalCreditedPaise);
}

/** Pure. Preserves existing behaviour: netBill = 0 counts as 'paid'. */
export function computePaymentStatus(netBillPaise: number, activePaidPaise: number): PaymentStatus {
  if (activePaidPaise >= netBillPaise) return 'paid';
  if (activePaidPaise > 0) return 'partially_paid';
  return 'unpaid';
}

export interface CreditNoteLike {
  lifecycle_status?: string | null;
  status?: string | null;
  grand_total_paise?: number | string | null;
}

export interface PaymentLike {
  status?: string | null;
  amount_paise?: number | string | null;
  /** 'payment' (received) or 'refund' (paid back). Missing => 'payment' (rows from before refunds existed). */
  kind?: string | null;
}

/** A credit note reduces the bill only when finalized AND active (same rule as loadInvoiceBalance). */
export function sumActiveCreditedPaise(notes: readonly CreditNoteLike[]): number {
  return notes
    .filter((n) => n.lifecycle_status === 'finalized' && (n.status || 'active') === 'active')
    .reduce((sum, n) => sum + Number(n.grand_total_paise || 0), 0);
}

const isActive = (p: PaymentLike): boolean => (p.status || 'active') === 'active';
const isRefund = (p: PaymentLike): boolean => p.kind === 'refund';

/** Money received from the customer: active payments only (voided ones never count). */
export function sumActiveReceivedPaise(payments: readonly PaymentLike[]): number {
  return payments.filter((p) => isActive(p) && !isRefund(p)).reduce((sum, p) => sum + Number(p.amount_paise || 0), 0);
}

/** Money paid back to the customer: active refunds only (a voided refund failed or was reversed). */
export function sumActiveRefundedPaise(payments: readonly PaymentLike[]): number {
  return payments.filter((p) => isActive(p) && isRefund(p)).reduce((sum, p) => sum + Number(p.amount_paise || 0), 0);
}

/** NET money kept from the customer = received − refunded. This is what settles the bill. */
export function sumActivePaidPaise(payments: readonly PaymentLike[]): number {
  return sumActiveReceivedPaise(payments) - sumActiveRefundedPaise(payments);
}

/** Money owed BACK to the customer: what was kept beyond the (credit-note reduced) bill. */
export function computeRefundDuePaise(netBillPaise: number, netReceivedPaise: number): number {
  return Math.max(0, netReceivedPaise - netBillPaise);
}

/**
 * THE refund rule: refunds may only return an overpayment. Refunded money must never exceed what was received
 * beyond the bill. Checked after every money change (refund, payment void, credit note void) under the invoice lock.
 */
export function refundsExceedOverpayment(netBillPaise: number, receivedPaise: number, refundedPaise: number): boolean {
  return refundedPaise > Math.max(0, receivedPaise - netBillPaise);
}

export interface SettlementSummary {
  totalCreditedPaise: number;
  netBillPaise: number;
  activePaidPaise: number;
  balanceDuePaise: number;
  remainingPaise: number;
  /** Money owed back to the customer (0 unless they have paid more than the reduced bill). */
  refundDuePaise: number;
  settledPercent: number;
  status: PaymentStatus;
}

export function summarizeSettlement(input: {
  grandTotalPaise: number | string | null | undefined;
  totalCreditedPaise: number;
  activePaidPaise: number;
}): SettlementSummary {
  const netBillPaise = computeNetBillPaise(Number(input.grandTotalPaise || 0), input.totalCreditedPaise);
  const balanceDuePaise = netBillPaise - input.activePaidPaise; // UNCLAMPED, exactly like the screens today
  const remainingPaise = Math.max(0, balanceDuePaise);
  const refundDuePaise = computeRefundDuePaise(netBillPaise, input.activePaidPaise);
  const settledPercent =
    netBillPaise > 0 ? Math.min(100, Math.round((input.activePaidPaise / netBillPaise) * 100)) : 100;
  const status = computePaymentStatus(netBillPaise, input.activePaidPaise);

  return {
    totalCreditedPaise: input.totalCreditedPaise,
    netBillPaise,
    activePaidPaise: input.activePaidPaise,
    balanceDuePaise,
    remainingPaise,
    refundDuePaise,
    settledPercent,
    status,
  };
}

