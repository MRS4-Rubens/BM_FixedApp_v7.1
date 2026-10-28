import { describe, expect, it } from 'vitest';
import {
  computeNetBillPaise,
  computePaymentStatus,
  type PaymentStatus,
} from '@/lib/invoices/payment-status';

describe('lib/invoices/payment-status pure logic', () => {
  describe('computePaymentStatus', () => {
    const testCases: ReadonlyArray<{
      readonly netBillPaise: number;
      readonly activePaidPaise: number;
      readonly expected: PaymentStatus;
      readonly description: string;
    }> = [
      {
        netBillPaise: 1000,
        activePaidPaise: 0,
        expected: 'unpaid',
        description: '(1000, 0) -> unpaid',
      },
      {
        netBillPaise: 1000,
        activePaidPaise: 1,
        expected: 'partially_paid',
        description: '(1000, 1) -> partially_paid',
      },
      {
        netBillPaise: 1000,
        activePaidPaise: 999,
        expected: 'partially_paid',
        description: '(1000, 999) -> partially_paid',
      },
      {
        netBillPaise: 1000,
        activePaidPaise: 1000,
        expected: 'paid',
        description: '(1000, 1000) -> paid',
      },
      {
        netBillPaise: 1000,
        activePaidPaise: 1500,
        expected: 'paid',
        description: '(1000, 1500) -> paid (overpayment fallback/recovery)',
      },
      {
        netBillPaise: 0,
        activePaidPaise: 0,
        expected: 'paid',
        description: '(0, 0) -> paid (legacy fully-credited behavior)',
      },
    ];

    it.each(testCases)('$description', ({ netBillPaise, activePaidPaise, expected }) => {
      expect(computePaymentStatus(netBillPaise, activePaidPaise)).toBe(expected);
    });
  });

  describe('computeNetBillPaise', () => {
    it('calculates grandTotal - credited when credited <= grandTotal', () => {
      expect(computeNetBillPaise(100000, 25000)).toBe(75000);
      expect(computeNetBillPaise(100000, 100000)).toBe(0);
      expect(computeNetBillPaise(5000, 0)).toBe(5000);
      expect(computeNetBillPaise(0, 0)).toBe(0);
    });

    it('clamps to 0 when credited > grandTotal', () => {
      expect(computeNetBillPaise(1000, 1500)).toBe(0);
      expect(computeNetBillPaise(0, 500)).toBe(0);
    });
  });
});

