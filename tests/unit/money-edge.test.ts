import { describe, expect, it } from 'vitest';
import {
  formatPaiseAsInr,
  paiseToRupees,
  parseQuantityToMilli,
  parseRupeesToPaise,
  percentOfPaiseRoundHalfUp,
  rupeesToPaise,
  multiplyMilliByPaiseRoundHalfUp,
} from '@/lib/money';
import { mulberry32, randomInt } from '../helpers/prng';

describe('Money Edge Cases & Precision (TEST-001)', () => {
  describe('SPEC: formatPaiseAsInr (Indian digit grouping)', () => {
    it('formats exact statutory currency boundaries', () => {
      expect(formatPaiseAsInr(0)).toBe('₹0.00');
      expect(formatPaiseAsInr(1)).toBe('₹0.01');
      expect(formatPaiseAsInr(99)).toBe('₹0.99');
      expect(formatPaiseAsInr(100)).toBe('₹1.00');
      expect(formatPaiseAsInr(123456789)).toBe('₹12,34,567.89');
      // Indian system: 9,99,99,99,999.99 (crore grouping)
      expect(formatPaiseAsInr(999999999999)).toBe('₹9,99,99,99,999.99');
      expect(formatPaiseAsInr(-100)).toBe('-₹1.00');
    });
  });

  describe('SPEC: parseRupeesToPaise & rupeesToPaise', () => {
    it('parses valid numeric and string inputs accurately', () => {
      expect(parseRupeesToPaise('  100  ')).toBe(10_000);
      expect(parseRupeesToPaise('0.00')).toBe(0);
      expect(parseRupeesToPaise('19.99')).toBe(1_999);
      expect(parseRupeesToPaise(19.99)).toBe(1_999);
      expect(parseRupeesToPaise('999999999.99')).toBe(99_999_999_999);
      expect(parseRupeesToPaise(-0)).toBe(0);
    });

    it('rejects invalid, malformed, or ambiguous string/numeric representations', () => {
      // Missing integer part or trailing dot
      expect(parseRupeesToPaise('.5')).toBeNull();
      expect(parseRupeesToPaise('5.')).toBeNull();

      // 10 or more integer digits
      expect(parseRupeesToPaise('1000000000')).toBeNull();

      // Non-digit symbols, currency marks, commas, empty, scientific notation
      expect(parseRupeesToPaise('1,000')).toBeNull();
      expect(parseRupeesToPaise('₹5')).toBeNull();
      expect(parseRupeesToPaise('')).toBeNull();
      expect(parseRupeesToPaise('   ')).toBeNull();
      expect(parseRupeesToPaise('1e3')).toBeNull();

      // Non-finite floats
      expect(parseRupeesToPaise(NaN)).toBeNull();
      expect(parseRupeesToPaise(Infinity)).toBeNull();
      expect(parseRupeesToPaise(-Infinity)).toBeNull();

      // Float representation anomalies like 0.1 + 0.2 (0.30000000000000004 has >2 decimals)
      expect(parseRupeesToPaise(0.1 + 0.2)).toBeNull();
    });

    it('rupeesToPaise throws RangeError when input cannot be exact 2-decimal paise', () => {
      expect(rupeesToPaise(19.99)).toBe(1_999);
      expect(rupeesToPaise(100)).toBe(10_000);

      // Sibling change (API-006): rupeesToPaise delegates to parseRupeesToPaise,
      // throwing RangeError on 3+ decimals or float drift rather than blindly Math.round.
      expect(() => rupeesToPaise(0.005)).toThrow(RangeError);
      expect(() => rupeesToPaise(0.004)).toThrow(RangeError);
      expect(() => rupeesToPaise(1.005)).toThrow(RangeError);
      expect(() => rupeesToPaise(0.1 + 0.2)).toThrow(RangeError);
    });
  });

  describe('PROP: paiseToRupees round-trip across 5,000 random integers', () => {
    it('round-trips identically: rupeesToPaise(paiseToRupees(p)) === p', () => {
      const prng = mulberry32(12345);
      for (let i = 0; i < 5000; i++) {
        const p = randomInt(prng, 0, 999_999_999);
        expect(rupeesToPaise(paiseToRupees(p))).toBe(p);
      }
    });
  });

  describe('SPEC: Sibling Helpers in lib/money.ts', () => {
    it('parseQuantityToMilli parses up to 3 decimals or returns null', () => {
      expect(parseQuantityToMilli('1.5')).toBe(1500);
      expect(parseQuantityToMilli('2.125')).toBe(2125);
      expect(parseQuantityToMilli(2.5)).toBe(2500);
      expect(parseQuantityToMilli('0')).toBe(0);
      expect(parseQuantityToMilli('1.0005')).toBeNull(); // 4 decimals
      expect(parseQuantityToMilli('12345678')).toBeNull(); // > 7 integer digits
      expect(parseQuantityToMilli(NaN)).toBeNull();
    });

    it('multiplyMilliByPaiseRoundHalfUp performs exact half-up scaling', () => {
      // 1.005 qty (1005 milli) * 100 paise = 100500 / 1000 = 100.5 -> rounds UP to 101
      expect(multiplyMilliByPaiseRoundHalfUp(1005, 100)).toBe(101);
      // 1.004 qty (1004 milli) * 100 paise = 100400 / 1000 = 100.4 -> rounds DOWN to 100
      expect(multiplyMilliByPaiseRoundHalfUp(1004, 100)).toBe(100);

      // Type guards
      // Permitted cast simulating invalid negative integer at runtime
      expect(() => multiplyMilliByPaiseRoundHalfUp(-1 as unknown as number, 100)).toThrow(RangeError);
    });

    it('percentOfPaiseRoundHalfUp calculates exact integer percentage of paise', () => {
      expect(percentOfPaiseRoundHalfUp(1000, 18)).toBe(180);
      expect(percentOfPaiseRoundHalfUp(10, 5)).toBe(1); // 50 / 100 = 0.5 -> 1
      expect(percentOfPaiseRoundHalfUp(9, 5)).toBe(0);  // 45 / 100 = 0.45 -> 0
      // Permitted cast simulating invalid percentage at runtime
      expect(() => percentOfPaiseRoundHalfUp(1000, 101 as unknown as number)).toThrow(RangeError);
    });
  });
});
