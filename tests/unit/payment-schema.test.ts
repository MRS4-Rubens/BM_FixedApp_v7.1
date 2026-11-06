import { describe, expect, it } from 'vitest';
import { recordPaymentSchema } from '@/lib/validations/payment';
import { isValidIsoDate } from '@/lib/invoices/ist-date';

describe('Payment validation schema and calendar date check', () => {
  const validBase = {
    invoice_id: 'a0000000-0000-4000-a000-000000000001',
    amount: 100,
    payment_date: '2026-04-30',
    payment_method: 'bank_transfer' as const,
  };

  describe('recordPaymentSchema amount validation', () => {
    it('accepts valid amounts', () => {
      const validAmounts = ['0.01', 0.01, 100, '1000.50', 1000.5, 99999999.99, '99999999.99'];
      for (const amount of validAmounts) {
        const result = recordPaymentSchema.safeParse({ ...validBase, amount });
        expect(result.success, `Expected amount ${amount} to be valid`).toBe(true);
      }
    });

    it('rejects zero, negative, fractional paise, too large, or non-numeric amounts', () => {
      const invalidAmounts = [
        0,
        '0',
        -5,
        '-10',
        0.004,
        '0.004',
        100.456,
        '100.456',
        100000000,
        '100000000',
        '',
        'abc',
      ];
      for (const amount of invalidAmounts) {
        const result = recordPaymentSchema.safeParse({ ...validBase, amount });
        expect(result.success, `Expected amount ${amount} to be invalid`).toBe(false);
      }
    });
  });

  describe('recordPaymentSchema payment_date validation', () => {
    it('accepts valid calendar dates', () => {
      const validDates = ['2024-02-29', '2026-04-30', '2026-12-31', '2026-01-01'];
      for (const payment_date of validDates) {
        const result = recordPaymentSchema.safeParse({ ...validBase, payment_date });
        expect(result.success, `Expected date ${payment_date} to be valid`).toBe(true);
      }
    });

    it('rejects invalid, impossible calendar dates and bad formats', () => {
      const invalidDates = [
        '2026-02-31', // impossible calendar date (Date.parse rolls over, but schema rejects)
        '2026-02-29', // 2026 is not a leap year
        '2026-13-01', // month 13
        '2026-1-5',   // missing zero-padding
        '2026/04/30', // slashes instead of hyphens
        '',
        'not a date',
      ];
      for (const payment_date of invalidDates) {
        const result = recordPaymentSchema.safeParse({ ...validBase, payment_date });
        expect(result.success, `Expected date ${payment_date} to be invalid`).toBe(false);
      }
    });
  });

  describe('isValidIsoDate', () => {
    it('validates leap years and historical ISO dates correctly', () => {
      expect(isValidIsoDate('2024-02-29')).toBe(true);
      expect(isValidIsoDate('2000-02-29')).toBe(true);
      expect(isValidIsoDate('0000-01-01')).toBe(true);
      expect(isValidIsoDate('1999-12-31')).toBe(true);
    });

    it('rejects non-existent days in months', () => {
      expect(isValidIsoDate('2026-02-31')).toBe(false);
      expect(isValidIsoDate('2026-02-29')).toBe(false);
      expect(isValidIsoDate('2026-04-31')).toBe(false);
      expect(isValidIsoDate('2026-06-31')).toBe(false);
      expect(isValidIsoDate('2026-09-31')).toBe(false);
      expect(isValidIsoDate('2026-11-31')).toBe(false);
      expect(isValidIsoDate('2026-00-10')).toBe(false);
      expect(isValidIsoDate('2026-13-01')).toBe(false);
    });
  });
});
