import { describe, expect, it } from 'vitest';
import {
  MAX_SAFE_PAISE,
  MAX_UNIT_PRICE_RUPEES,
  MAX_UNIT_PRICE_PAISE,
  MAX_LINE_GROSS_PAISE,
  MAX_DOCUMENT_TOTAL_PAISE,
  MAX_INVOICE_LINE_ITEMS,
} from '@/lib/money-limits';

describe('lib/money-limits constants and invariants', () => {
  it('MAX_SAFE_PAISE equals 9007199254740991 (guards the literal in the SQL CHECKs)', () => {
    expect(MAX_SAFE_PAISE).toBe(9007199254740991);
    expect(MAX_SAFE_PAISE).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('MAX_UNIT_PRICE_PAISE matches Math.round(MAX_UNIT_PRICE_RUPEES * 100)', () => {
    expect(MAX_UNIT_PRICE_PAISE).toBe(Math.round(MAX_UNIT_PRICE_RUPEES * 100));
  });

  it('MAX_LINE_GROSS_PAISE and MAX_DOCUMENT_TOTAL_PAISE are strictly less than MAX_SAFE_PAISE', () => {
    expect(MAX_LINE_GROSS_PAISE).toBeLessThan(MAX_SAFE_PAISE);
    expect(MAX_DOCUMENT_TOTAL_PAISE).toBeLessThan(MAX_SAFE_PAISE);
  });

  it('safe-sum invariant: MAX_INVOICE_LINE_ITEMS * MAX_LINE_GROSS_PAISE * 1.28 < MAX_SAFE_PAISE', () => {
    const worstCaseSumPaise = MAX_INVOICE_LINE_ITEMS * MAX_LINE_GROSS_PAISE * 1.28;
    expect(worstCaseSumPaise).toBeLessThan(MAX_SAFE_PAISE);
  });

  it('MAX_DOCUMENT_TOTAL_PAISE / 100 is strictly below 10_000_000_000 (below INR 1,000 crore for number-to-words coupling)', () => {
    expect(MAX_DOCUMENT_TOTAL_PAISE / 100).toBeLessThan(10_000_000_000);
  });
});

