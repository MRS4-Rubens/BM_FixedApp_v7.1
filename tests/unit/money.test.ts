import { describe, expect, it } from 'vitest';

import { formatPaiseAsInr, paiseToRupees, roundToRupeePaise, rupeesToPaise } from '@/lib/money';
import { roundToRupeePaise as derivationRoundToRupeePaise } from '@/lib/credit-notes/derivation';

describe('lib/money', () => {
  it('converts rupees to integer paise', () => {
    expect(rupeesToPaise(0)).toBe(0);
    expect(rupeesToPaise(19.99)).toBe(1999);
    expect(rupeesToPaise(1500.5)).toBe(150050);
  });

  it('always returns integer paise', () => {
    for (const rupees of [0.1, 0.2, 0.3, 10.01, 99.99, 12345.67]) {
      expect(Number.isInteger(rupeesToPaise(rupees))).toBe(true);
    }
  });

  it('converts paise back to rupees', () => {
    expect(paiseToRupees(1999)).toBe(19.99);
    expect(paiseToRupees(0)).toBe(0);
  });

  it('formats paise using Indian digit grouping', () => {
    expect(formatPaiseAsInr(150050)).toBe('₹1,500.50');
    expect(formatPaiseAsInr(10000000)).toBe('₹1,00,000.00');
  });

  it('rounds to rupee paise matching Math.round(x/100)*100 and matches derivation re-export', () => {
    const testCases = [0, 49, 50, 149, 150, 12345, 99_999_950];
    for (const paise of testCases) {
      expect(roundToRupeePaise(paise)).toBe(Math.round(paise / 100) * 100);
    }
    expect(roundToRupeePaise).toBe(derivationRoundToRupeePaise);
  });
});
