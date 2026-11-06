import { describe, expect, it } from 'vitest';
import { roundToRupeePaise } from '@/lib/credit-notes/derivation';
import { mulberry32, randomInt } from '../helpers/prng';

describe('Round to Rupee Paise (TEST-001)', () => {
  const boundaryCases: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [49, 0],
    [50, 100], // exact .50 rounds UP
    [51, 100],
    [99, 100],
    [100, 100],
    [149, 100],
    [150, 200],
    [151, 200],
    [12349, 12300],
    [12350, 12400],
    [150049, 150000],
    [150050, 150100],
    [10_000_000_049, 10_000_000_000],
    [10_000_000_050, 10_000_000_100],
  ];

  it('SPEC: boundary table for half-up rupee rounding', () => {
    for (const [inputPaise, expectedPaise] of boundaryCases) {
      expect(roundToRupeePaise(inputPaise)).toBe(expectedPaise);
    }
  });

  it('PARITY: roundToRupeePaise matches inline Math.round(p / 100) * 100 identically across all boundary cases', () => {
    for (const [inputPaise] of boundaryCases) {
      const inlineResult = Math.round(inputPaise / 100) * 100;
      expect(roundToRupeePaise(inputPaise)).toBe(inlineResult);
    }
  });

  it('PROP: result is always a multiple of 100 and within 50 paise of input', () => {
    const prng = mulberry32(999);
    for (let i = 0; i < 5000; i++) {
      const p = randomInt(prng, 0, 10_000_000);
      const rounded = roundToRupeePaise(p);

      expect(rounded % 100).toBe(0);
      expect(Math.abs(rounded - p)).toBeLessThanOrEqual(50);
      expect(rounded).toBe(Math.round(p / 100) * 100);
    }
  });
});
