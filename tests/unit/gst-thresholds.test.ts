import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { B2CL_THRESHOLDS, b2clThresholdPaise, isB2clLargeInvoice } from '@/lib/gst/thresholds';

/**
 * COMP-002: B2CL threshold boundary table. Amounts are integer PAISE: Rs 1,00,000.00 = 10_000_000.
 * Rule: an inter-State B2C invoice is "large" only when its value is STRICTLY MORE than the threshold in force on the
 * invoice date (Rs 2,50,000 up to 31-Jul-2024; Rs 1,00,000 from 01-Aug-2024 - Notification No. 12/2024-Central Tax).
 */

const ONE_LAKH = 10_000_000;
const TWO_POINT_FIVE_LAKH = 25_000_000;

describe('b2clThresholdPaise (effective dating)', () => {
  it.each([
    ['2017-07-01', TWO_POINT_FIVE_LAKH],
    ['2020-01-01', TWO_POINT_FIVE_LAKH],
    ['2024-07-31', TWO_POINT_FIVE_LAKH],
    ['2024-08-01', ONE_LAKH],
    ['2024-08-02', ONE_LAKH],
    ['2026-10-28', ONE_LAKH],
    ['2099-12-31', ONE_LAKH],
  ])('invoice dated %s -> %i paise', (date, expected) => {
    expect(b2clThresholdPaise(date)).toBe(expected);
  });

  it('uses the oldest rule for dates before the table starts, and the newest rule when the date is unknown', () => {
    expect(b2clThresholdPaise('2010-01-01')).toBe(TWO_POINT_FIVE_LAKH);
    expect(b2clThresholdPaise(null)).toBe(ONE_LAKH);
  });

  it.each(['', '2024-8-1', '01-08-2024', '2024/08/01', '2024-13-01', '2024-02-30', '2024-00-10', 'not a date'])(
    'rejects the invalid date %j instead of guessing',
    (value) => {
      expect(() => b2clThresholdPaise(value)).toThrow(RangeError);
    },
  );
});

describe('isB2clLargeInvoice boundary table', () => {
  // [description, paise, date, expected]
  const table: Array<[string, number, string, boolean]> = [
    // From 01-Aug-2024 the limit is Rs 1,00,000 and the test is "more than".
    ['Rs 99,999.99 (after 1-Aug-2024)', 9_999_999, '2024-08-01', false],
    ['Rs 1,00,000.00 exactly (after 1-Aug-2024)', 10_000_000, '2024-08-01', false],
    ['Rs 1,00,000.01 (after 1-Aug-2024)', 10_000_001, '2024-08-01', true],
    ['Rs 1,50,000 (after 1-Aug-2024) - the audit scenario', 15_000_000, '2026-10-15', true],
    ['Rs 2,50,000 (after 1-Aug-2024)', 25_000_000, '2024-09-15', true],
    // Up to 31-Jul-2024 the old limit of Rs 2,50,000 still applies.
    ['Rs 1,50,000 on 31-Jul-2024', 15_000_000, '2024-07-31', false],
    ['Rs 1,00,000.01 on 31-Jul-2024', 10_000_001, '2024-07-31', false],
    ['Rs 2,50,000.00 exactly on 31-Jul-2024', 25_000_000, '2024-07-31', false],
    ['Rs 2,50,000.01 on 31-Jul-2024', 25_000_001, '2024-07-31', true],
    // The day the rule changes.
    ['Rs 1,50,000 on 01-Aug-2024', 15_000_000, '2024-08-01', true],
    // Edges.
    ['zero value', 0, '2026-10-15', false],
    ['very large value', 9_000_000_000_000, '2026-10-15', true],
  ];

  it.each(table)('%s', (_description, paise, date, expected) => {
    expect(isB2clLargeInvoice(paise, date)).toBe(expected);
  });

  it('rejects fractional, negative or non-finite paise (money must be integer paise)', () => {
    expect(() => isB2clLargeInvoice(10_000_000.5, '2026-10-15')).toThrow(RangeError);
    expect(() => isB2clLargeInvoice(-1, '2026-10-15')).toThrow(RangeError);
    expect(() => isB2clLargeInvoice(Number.NaN, '2026-10-15')).toThrow(RangeError);
    expect(() => isB2clLargeInvoice(Number.POSITIVE_INFINITY, '2026-10-15')).toThrow(RangeError);
  });
});

describe('B2CL_THRESHOLDS table integrity', () => {
  it('is non-empty, strictly ascending by date, and uses positive integer paise with a source for each rule', () => {
    expect(B2CL_THRESHOLDS.length).toBeGreaterThan(0);
    B2CL_THRESHOLDS.forEach((rule, index) => {
      expect(rule.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isSafeInteger(rule.paise)).toBe(true);
      expect(rule.paise).toBeGreaterThan(0);
      expect(rule.source.length).toBeGreaterThan(10);
      const previous = B2CL_THRESHOLDS[index - 1];
      if (previous) {
        expect(rule.from > previous.from).toBe(true);
      }
    });
  });

  it('encodes exactly the two legal rules known today', () => {
    expect(B2CL_THRESHOLDS.map((rule) => [rule.from, rule.paise])).toEqual([
      ['2017-07-01', TWO_POINT_FIVE_LAKH],
      ['2024-08-01', ONE_LAKH],
    ]);
  });
});

describe('no hard-coded B2CL thresholds outside lib/gst/thresholds.ts (regression guard)', () => {
  it.each(['lib/actions/reports/get-gstr1-data.ts', 'lib/excel/build-gstr1-report.ts'])('%s has no literal threshold', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    expect(source).not.toMatch(/25_?000_?000/);
    expect(source).not.toMatch(/\b10_?000_?000\b/);
  });
});

