import { describe, expect, it } from 'vitest';
import { parseRupeesToPaise } from '@/lib/money';

describe('lib/money parseRupeesToPaise', () => {
  it('correctly parses valid decimal numbers and strings into integer paise', () => {
    expect(parseRupeesToPaise(0.01)).toBe(1);
    expect(parseRupeesToPaise('0.01')).toBe(1);
    expect(parseRupeesToPaise(1.15)).toBe(115);
    expect(parseRupeesToPaise(19.99)).toBe(1999);
    expect(parseRupeesToPaise('1000.50')).toBe(100050);
    expect(parseRupeesToPaise(1000.5)).toBe(100050);
    expect(parseRupeesToPaise('1000.5')).toBe(100050);
    expect(parseRupeesToPaise('  12 ')).toBe(1200);
    expect(parseRupeesToPaise(12)).toBe(1200);
    expect(parseRupeesToPaise(99999999.99)).toBe(9999999999);
    expect(parseRupeesToPaise('99999999.99')).toBe(9999999999);
  });

  it('rejects numbers with more than 2 decimal places', () => {
    expect(parseRupeesToPaise('0.004')).toBeNull();
    expect(parseRupeesToPaise(0.004)).toBeNull();
    expect(parseRupeesToPaise(100.456)).toBeNull();
    expect(parseRupeesToPaise('100.456')).toBeNull();
    // 0.1 + 0.2 produces 0.30000000000000004
    expect(parseRupeesToPaise(0.1 + 0.2)).toBeNull();
  });

  it('rejects scientific notation and non-finite values', () => {
    expect(parseRupeesToPaise(1e-7)).toBeNull();
    expect(parseRupeesToPaise('1e-7')).toBeNull();
    expect(parseRupeesToPaise(1e21)).toBeNull();
    expect(parseRupeesToPaise('1e21')).toBeNull();
    expect(parseRupeesToPaise(NaN)).toBeNull();
    expect(parseRupeesToPaise(Infinity)).toBeNull();
    expect(parseRupeesToPaise(-Infinity)).toBeNull();
  });

  it('rejects negatives and non-numeric strings', () => {
    expect(parseRupeesToPaise(-5)).toBeNull();
    expect(parseRupeesToPaise('-5')).toBeNull();
    expect(parseRupeesToPaise('abc')).toBeNull();
    expect(parseRupeesToPaise('')).toBeNull();
    expect(parseRupeesToPaise('   ')).toBeNull();
  });

  it('rejects malformed numbers without leading digits or with trailing dots or commas', () => {
    expect(parseRupeesToPaise('.5')).toBeNull();
    expect(parseRupeesToPaise('12.')).toBeNull();
    expect(parseRupeesToPaise('1,000')).toBeNull();
    expect(parseRupeesToPaise('1,000.50')).toBeNull();
  });
});

