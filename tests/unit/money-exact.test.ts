import { describe, expect, it } from 'vitest';
import {
  parseQuantityToMilli,
  multiplyMilliByPaiseRoundHalfUp,
  percentOfPaiseRoundHalfUp,
  rupeesToPaise,
} from '@/lib/money';

describe('lib/money exact arithmetic & parsing', () => {
  describe('parseQuantityToMilli', () => {
    it('parses integers and decimals up to 3 decimal places', () => {
      expect(parseQuantityToMilli('0')).toBe(0);
      expect(parseQuantityToMilli('1')).toBe(1000);
      expect(parseQuantityToMilli(1)).toBe(1000);
      expect(parseQuantityToMilli('1.5')).toBe(1500);
      expect(parseQuantityToMilli('1.25')).toBe(1250);
      expect(parseQuantityToMilli('1.234')).toBe(1234);
      expect(parseQuantityToMilli(1.234)).toBe(1234);
      expect(parseQuantityToMilli('0.001')).toBe(1);
      expect(parseQuantityToMilli('9999999.999')).toBe(9999999999);
    });

    it('rejects more than 3 decimal places', () => {
      expect(parseQuantityToMilli('1.2345')).toBeNull();
      expect(parseQuantityToMilli(1.2345)).toBeNull();
      expect(parseQuantityToMilli('0.0001')).toBeNull();
    });

    it('rejects negative, non-numeric, or malformed inputs', () => {
      expect(parseQuantityToMilli('-1')).toBeNull();
      expect(parseQuantityToMilli(-1.5)).toBeNull();
      expect(parseQuantityToMilli('abc')).toBeNull();
      expect(parseQuantityToMilli('')).toBeNull();
      expect(parseQuantityToMilli('   ')).toBeNull();
      expect(parseQuantityToMilli('.5')).toBeNull();
      expect(parseQuantityToMilli('1.')).toBeNull();
      expect(parseQuantityToMilli(NaN)).toBeNull();
      expect(parseQuantityToMilli(Infinity)).toBeNull();
    });
  });

  describe('multiplyMilliByPaiseRoundHalfUp', () => {
    it('implements standard half-up rounding', () => {
      // 0.500 qty (500 milli) * 1 paise = 0.5 paise -> rounds UP to 1
      expect(multiplyMilliByPaiseRoundHalfUp(500, 1)).toBe(1);
      // 0.499 qty (499 milli) * 1 paise = 0.499 paise -> rounds DOWN to 0
      expect(multiplyMilliByPaiseRoundHalfUp(499, 1)).toBe(0);
      // 0.501 qty (501 milli) * 1 paise = 0.501 paise -> rounds UP to 1
      expect(multiplyMilliByPaiseRoundHalfUp(501, 1)).toBe(1);
      // 1.000 qty (1000 milli) * 1000 paise = 1000 paise
      expect(multiplyMilliByPaiseRoundHalfUp(1000, 1000)).toBe(1000);
      // 3.000 qty (3000 milli) * 333 paise = 999 paise
      expect(multiplyMilliByPaiseRoundHalfUp(3000, 333)).toBe(999);
      // 1.500 qty (1500 milli) * 3 paise = 4.5 paise -> rounds UP to 5
      expect(multiplyMilliByPaiseRoundHalfUp(1500, 3)).toBe(5);
      // 1.500 qty (1500 milli) * 5 paise = 7.5 paise -> rounds UP to 8
      expect(multiplyMilliByPaiseRoundHalfUp(1500, 5)).toBe(8);
    });

    it('matches exact half-up formula across 20,000 cases', () => {
      for (let i = 0; i < 20000; i++) {
        const qMilli = (i * 37) % 50000; // 0 to 50.000
        const unitPaise = (i * 53) % 100000; // 0 to 1,000.00 rupees
        const expected = Number((BigInt(qMilli) * BigInt(unitPaise) + BigInt(500)) / BigInt(1000));
        const actual = multiplyMilliByPaiseRoundHalfUp(qMilli, unitPaise);
        expect(actual).toBe(expected);
      }
    });
  });

  describe('percentOfPaiseRoundHalfUp', () => {
    it('implements standard half-up rounding for integer percentages', () => {
      // 50% of 1 paise = 0.5 -> 1 paise
      expect(percentOfPaiseRoundHalfUp(1, 50)).toBe(1);
      // 49% of 1 paise = 0.49 -> 0 paise
      expect(percentOfPaiseRoundHalfUp(1, 49)).toBe(0);
      // 100% of 1000 paise = 1000 paise
      expect(percentOfPaiseRoundHalfUp(1000, 100)).toBe(1000);
      // 0% of 1000 paise = 0 paise
      expect(percentOfPaiseRoundHalfUp(1000, 0)).toBe(0);
      // 18% of 100 paise = 18 paise
      expect(percentOfPaiseRoundHalfUp(100, 18)).toBe(18);
      // 18% of 105 paise = 18.9 -> 19 paise
      expect(percentOfPaiseRoundHalfUp(105, 18)).toBe(19);
    });

    it('matches exact half-up formula across 10,000 cases', () => {
      for (let i = 0; i < 10000; i++) {
        const basePaise = (i * 73) % 100000;
        const ratePct = (i * 7) % 101; // 0 to 100%
        const expected = Number((BigInt(basePaise) * BigInt(ratePct) + BigInt(50)) / BigInt(100));
        const actual = percentOfPaiseRoundHalfUp(basePaise, ratePct);
        expect(actual).toBe(expected);
      }
    });

    it('throws on non-integer or out-of-range percentage', () => {
      expect(() => percentOfPaiseRoundHalfUp(100, -1)).toThrow(RangeError);
      expect(() => percentOfPaiseRoundHalfUp(100, 101)).toThrow(RangeError);
      expect(() => percentOfPaiseRoundHalfUp(100, 18.5)).toThrow(RangeError);
    });
  });

  describe('rupeesToPaise', () => {
    it('delegates to parseRupeesToPaise and throws RangeError on invalid numbers', () => {
      expect(rupeesToPaise(10.5)).toBe(1050);
      expect(rupeesToPaise(10)).toBe(1000);
      expect(() => (rupeesToPaise as (r: unknown) => number)('abc')).toThrow(RangeError);
      expect(() => rupeesToPaise(-5)).toThrow(RangeError);
      expect(() => rupeesToPaise(0.001)).toThrow(RangeError);
    });
  });
});
