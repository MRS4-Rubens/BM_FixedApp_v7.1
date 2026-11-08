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
}

/** A credit note reduces the bill only when finalized AND active (same rule as loadInvoiceBalance). */
export function sumActiveCreditedPaise(notes: readonly CreditNoteLike[]): number {
  return notes
    .filter((n) => n.lifecycle_status === 'finalized' && (n.status || 'active') === 'active')
    .reduce((sum, n) => sum + Number(n.grand_total_paise || 0), 0);
}

/** Only active payments count (voided ones never do). */
export function sumActivePaidPaise(payments: readonly PaymentLike[]): number {
  return payments
    .filter((p) => (p.status || 'active') === 'active')
    .reduce((sum, p) => sum + Number(p.amount_paise || 0), 0);
}

export interface SettlementSummary {
  totalCreditedPaise: number;
  netBillPaise: number;
  activePaidPaise: number;
  balanceDuePaise: number;
  remainingPaise: number;
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
  const settledPercent =
    netBillPaise > 0 ? Math.min(100, Math.round((input.activePaidPaise / netBillPaise) * 100)) : 100;
  const status = computePaymentStatus(netBillPaise, input.activePaidPaise);

  return {
    totalCreditedPaise: input.totalCreditedPaise,
    netBillPaise,
    activePaidPaise: input.activePaidPaise,
    balanceDuePaise,
    remainingPaise,
    settledPercent,
    status,
  };
}

