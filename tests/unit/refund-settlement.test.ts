// REFUND: the money maths for every scenario in the refund plan (pure functions, no database).
import { describe, expect, it } from 'vitest';
import {
  computeRefundDuePaise,
  refundsExceedOverpayment,
  sumActivePaidPaise,
  sumActiveReceivedPaise,
  sumActiveRefundedPaise,
  summarizeSettlement,
  type PaymentLike,
} from '@/lib/invoices/settlement';
import { getDisplayInvoiceStatus } from '@/lib/invoices/status';

const pay = (amount: number, extra: Partial<PaymentLike> = {}): PaymentLike => ({ amount_paise: amount, status: 'active', ...extra });
const refund = (amount: number, extra: Partial<PaymentLike> = {}): PaymentLike => pay(amount, { kind: 'refund', ...extra });

function settle(grand: number, credited: number, entries: PaymentLike[]) {
  return summarizeSettlement({ grandTotalPaise: grand, totalCreditedPaise: credited, activePaidPaise: sumActivePaidPaise(entries) });
}

describe('Refund maths', () => {
  it('sums received and refunded separately; voided entries never count; old rows without kind are payments', () => {
    const entries = [pay(5000), pay(3000, { kind: null }), refund(1000), refund(700, { status: 'voided' }), pay(400, { status: 'voided' })];
    expect(sumActiveReceivedPaise(entries)).toBe(8000);
    expect(sumActiveRefundedPaise(entries)).toBe(1000);
    expect(sumActivePaidPaise(entries)).toBe(7000); // net kept
  });

  it('credit note on an UNPAID invoice: bill shrinks, no refund', () => {
    const s = settle(100000, 30000, []);
    expect(s.remainingPaise).toBe(70000);
    expect(s.refundDuePaise).toBe(0);
  });

  it('credit note on a PARTLY paid invoice: Rs300 CN lowers the due; Rs800 CN creates a Rs200 refund due', () => {
    expect(settle(100000, 30000, [pay(40000)])).toMatchObject({ remainingPaise: 30000, refundDuePaise: 0 });
    expect(settle(100000, 80000, [pay(40000)])).toMatchObject({ remainingPaise: 0, refundDuePaise: 20000 });
  });

  it('credit note on a FULLY settled invoice: refund due = credit note amount (the screenshot case)', () => {
    const s = settle(1064500, 147000, [pay(532250), pay(532250)]);
    expect(s.netBillPaise).toBe(917500);
    expect(s.refundDuePaise).toBe(147000);
    expect(s.status).toBe('paid');
  });

  it('partial, multiple and full refunds bring the refund due down to zero', () => {
    const base = [pay(532250), pay(532250)];
    expect(settle(1064500, 147000, [...base, refund(50000)]).refundDuePaise).toBe(97000);
    expect(settle(1064500, 147000, [...base, refund(50000), refund(47000)]).refundDuePaise).toBe(50000);
    const full = settle(1064500, 147000, [...base, refund(50000), refund(97000)]);
    expect(full.refundDuePaise).toBe(0);
    expect(full.balanceDuePaise).toBe(0);
    expect(full.status).toBe('paid');
  });

  it('a voided (failed) refund brings the refund due back', () => {
    const s = settle(1064500, 147000, [pay(1064500), refund(147000, { status: 'voided' })]);
    expect(s.refundDuePaise).toBe(147000);
  });

  it('multiple credit notes add up', () => {
    expect(settle(100000, 20000 + 30000, [pay(100000)]).refundDuePaise).toBe(50000);
  });

  it('THE refund rule: refunds may never exceed the overpayment', () => {
    // net bill 9175, received 10645 -> at most 1470 may be refunded
    expect(refundsExceedOverpayment(917500, 1064500, 147000)).toBe(false);
    expect(refundsExceedOverpayment(917500, 1064500, 147001)).toBe(true);
    // voiding the credit note raises the bill back to 10645: the 1470 refund is no longer covered
    expect(refundsExceedOverpayment(1064500, 1064500, 147000)).toBe(true);
    // voiding a payment so that received < bill: refund no longer covered
    expect(refundsExceedOverpayment(917500, 532250, 147000)).toBe(true);
    // no refunds: never exceeds
    expect(refundsExceedOverpayment(917500, 0, 0)).toBe(false);
  });

  it('refund due is never negative', () => {
    expect(computeRefundDuePaise(1000, 500)).toBe(0);
    expect(computeRefundDuePaise(1000, 1500)).toBe(500);
  });

  it('a paid invoice still owing money back shows "refund_due"; once refunded it is "paid"', () => {
    const base = { lifecycle_status: 'finalized' as const, payment_status: 'paid' as const, due_date: null };
    expect(getDisplayInvoiceStatus({ ...base, refund_due_paise: 147000 })).toBe('refund_due');
    expect(getDisplayInvoiceStatus({ ...base, refund_due_paise: '147000' })).toBe('refund_due');
    expect(getDisplayInvoiceStatus({ ...base, refund_due_paise: 0 })).toBe('paid');
    expect(getDisplayInvoiceStatus(base)).toBe('paid'); // older callers without the field
  });
});
