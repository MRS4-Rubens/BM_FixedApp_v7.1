import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  computeNetBillPaise,
  computePaymentStatus,
  sumActiveCreditedPaise,
  sumActivePaidPaise,
  summarizeSettlement,
  type CreditNoteLike,
  type PaymentLike,
  type PaymentStatus,
} from '@/lib/invoices/settlement';
import {
  computeNetBillPaise as reexportedNetBill,
  computePaymentStatus as reexportedPaymentStatus,
} from '@/lib/invoices/payment-status';

function createLcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Legacy formulas copied verbatim from section 1 of the specification
function legacyTotalCreditedPaise(creditNotes: readonly CreditNoteLike[]): number {
  return creditNotes
    .filter((n) => n.lifecycle_status === 'finalized' && (n.status || 'active') === 'active')
    .reduce((acc, n) => acc + Number(n.grand_total_paise || 0), 0);
}

function legacyNetBillPaise(grandTotalPaise: number | string | null | undefined, totalCreditedPaise: number): number {
  return Math.max(0, Number(grandTotalPaise || 0) - totalCreditedPaise);
}

function legacyActivePaidPaise(payments: readonly PaymentLike[]): number {
  return payments
    .filter((p) => (p.status || 'active') === 'active')
    .reduce((acc, p) => acc + Number(p.amount_paise || 0), 0);
}

function legacyBalanceDue(netBillPaise: number, existingSum: number): number {
  return netBillPaise - existingSum;
}

function legacySettlementPercentage(netBillPaise: number, existingSum: number): number {
  return netBillPaise > 0 ? Math.min(100, Math.round((existingSum / netBillPaise) * 100)) : 100;
}

function legacyPaymentStatus(netBillPaise: number, activePaidPaise: number): PaymentStatus {
  if (activePaidPaise >= netBillPaise) return 'paid';
  if (activePaidPaise > 0) return 'partially_paid';
  return 'unpaid';
}

describe('lib/invoices/settlement', () => {
  it('1. Equivalence property test (500 cases with seeded LCG)', () => {
    const rand = createLcg(1337);

    const lifecycleOptions: (string | null | undefined)[] = ['draft', 'finalized', null, undefined];
    const statusOptions: (string | null | undefined)[] = ['active', 'voided', null, undefined];

    for (let i = 0; i < 500; i++) {
      const grandTotal = Math.floor(rand() * 10_000_000);
      const grandTotalInput = rand() > 0.5 ? grandTotal : String(grandTotal);

      const numNotes = Math.floor(rand() * 5); // 0..4
      const notes: CreditNoteLike[] = [];
      for (let j = 0; j < numNotes; j++) {
        const amount = Math.floor(rand() * 2_000_000);
        notes.push({
          lifecycle_status: lifecycleOptions[Math.floor(rand() * lifecycleOptions.length)],
          status: statusOptions[Math.floor(rand() * statusOptions.length)],
          grand_total_paise: rand() > 0.5 ? amount : String(amount),
        });
      }

      const numPayments = Math.floor(rand() * 6); // 0..5
      const payments: PaymentLike[] = [];
      for (let k = 0; k < numPayments; k++) {
        const amount = Math.floor(rand() * 3_000_000);
        payments.push({
          status: statusOptions[Math.floor(rand() * statusOptions.length)],
          amount_paise: rand() > 0.5 ? amount : String(amount),
        });
      }

      const expectedCredited = legacyTotalCreditedPaise(notes);
      const actualCredited = sumActiveCreditedPaise(notes);
      expect(actualCredited).toBe(expectedCredited);

      const expectedPaid = legacyActivePaidPaise(payments);
      const actualPaid = sumActivePaidPaise(payments);
      expect(actualPaid).toBe(expectedPaid);

      const expectedNetBill = legacyNetBillPaise(grandTotalInput, expectedCredited);
      const expectedBalanceDue = legacyBalanceDue(expectedNetBill, expectedPaid);
      const expectedSettledPercent = legacySettlementPercentage(expectedNetBill, expectedPaid);
      const expectedStatus = legacyPaymentStatus(expectedNetBill, expectedPaid);

      const summary = summarizeSettlement({
        grandTotalPaise: grandTotalInput,
        totalCreditedPaise: actualCredited,
        activePaidPaise: actualPaid,
      });

      expect(summary.totalCreditedPaise).toBe(expectedCredited);
      expect(summary.netBillPaise).toBe(expectedNetBill);
      expect(summary.activePaidPaise).toBe(expectedPaid);
      expect(summary.balanceDuePaise).toBe(expectedBalanceDue);
      expect(summary.settledPercent).toBe(expectedSettledPercent);
      expect(summary.status).toBe(expectedStatus);
      expect(summary.remainingPaise).toBe(Math.max(0, expectedBalanceDue));
    }
  });

  it('2. Edge cases', () => {
    // netBill 0 -> settledPercent 100, status 'paid'
    const zeroBill = summarizeSettlement({
      grandTotalPaise: 0,
      totalCreditedPaise: 0,
      activePaidPaise: 0,
    });
    expect(zeroBill.netBillPaise).toBe(0);
    expect(zeroBill.settledPercent).toBe(100);
    expect(zeroBill.status).toBe('paid');
    expect(zeroBill.balanceDuePaise).toBe(0);
    expect(zeroBill.remainingPaise).toBe(0);

    // Overpayment -> balanceDuePaise negative, remainingPaise 0
    const overpayment = summarizeSettlement({
      grandTotalPaise: 1000,
      totalCreditedPaise: 0,
      activePaidPaise: 1500,
    });
    expect(overpayment.netBillPaise).toBe(1000);
    expect(overpayment.balanceDuePaise).toBe(-500);
    expect(overpayment.remainingPaise).toBe(0);
    expect(overpayment.status).toBe('paid');
    expect(overpayment.settledPercent).toBe(100);

    // Credit notes larger than bill -> netBill 0
    const overcredited = summarizeSettlement({
      grandTotalPaise: 1000,
      totalCreditedPaise: 2000,
      activePaidPaise: 0,
    });
    expect(overcredited.netBillPaise).toBe(0);
    expect(overcredited.status).toBe('paid');
    expect(overcredited.settledPercent).toBe(100);

    // Voided and draft credit notes ignored
    const notes: CreditNoteLike[] = [
      { lifecycle_status: 'draft', status: 'active', grand_total_paise: 500 },
      { lifecycle_status: 'finalized', status: 'voided', grand_total_paise: 700 },
      { lifecycle_status: 'finalized', status: 'active', grand_total_paise: 1200 },
    ];
    expect(sumActiveCreditedPaise(notes)).toBe(1200);

    // Voided payments ignored
    const payments: PaymentLike[] = [
      { status: 'voided', amount_paise: 400 },
      { status: 'active', amount_paise: 600 },
      { status: undefined, amount_paise: 300 }, // undefined status defaults to active
    ];
    expect(sumActivePaidPaise(payments)).toBe(900);
  });

  it('3. settlement.ts has no db/schema/drizzle imports, and payment-status re-exports functions', () => {
    const settlementPath = path.resolve(__dirname, '../../lib/invoices/settlement.ts');
    const content = fs.readFileSync(settlementPath, 'utf8');

    expect(content).not.toMatch(/from\s+['"][^'"]*drizzle/);
    expect(content).not.toMatch(/from\s+['"][^'"]*schema/);
    expect(content).not.toMatch(/from\s+['"][^'"]*\/db/);

    expect(reexportedNetBill).toBe(computeNetBillPaise);
    expect(reexportedPaymentStatus).toBe(computePaymentStatus);
  });
});

