import { describe, expect, it } from 'vitest';
import {
  getPeriodKey,
  getResetGranularity,
  resolveInvoiceNumber,
  validateInvoiceNumberFormat,
} from '@/lib/invoices/number-format';
import { getIndianFinancialYearForDate } from '@/lib/invoices/financial-year';
import { mapKnownDatabaseError } from '@/lib/actions/_shared/action-error-mapping';
import { FINALIZE_INVOICE_MAPPINGS } from '@/lib/actions/_shared/pg-constraint-mappings';
import { DB_CONSTRAINTS } from '@/lib/db/constraint-names';
import { FREE_PLAN_INVOICE_NUMBER_FORMATS } from '@/lib/subscriptions/invoice-settings-gate';

/**
 * MONEY-01: the DB key invoices_business_id_invoice_number_unique is business-wide, while the counter restarts every
 * financial year (or month / day). A valid format must therefore never print the same number twice, in any period.
 */

/** Simulates real numbering (same functions as lib/invoices/numbering.ts) over three financial years, 2 invoices a day. */
function issuedNumbers(format: string): string[] {
  const granularity = getResetGranularity(format);
  const counters = new Map<string, number>();
  const numbers: string[] = [];
  // A shop that starts mid-year (1 Dec 2025, like every new pilot shop) until 31 Mar 2028, at 12:00 IST (06:30 UTC).
  // Starting mid-year matters: with {YY}, the low January counter of the first year meets the new FY's counter.
  for (let t = Date.UTC(2025, 11, 1, 6, 30); t <= Date.UTC(2028, 2, 31, 6, 30); t += 86_400_000) {
    const invoiceDate = new Date(t);
    const fy = getIndianFinancialYearForDate(invoiceDate);
    const key = getPeriodKey(granularity, fy.label, invoiceDate);
    for (let i = 0; i < 2; i += 1) {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      numbers.push(resolveInvoiceNumber(format, { invoiceDate, fyLabel: fy.label, sequenceValue: next }));
    }
  }
  return numbers;
}

const duplicates = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
};

const ACCEPTED = [
  ...FREE_PLAN_INVOICE_NUMBER_FORMATS,
  'INV/{FY}/{SEQ:4}',
  'INV-{FY}-{SEQ:3}',
  'INV/{FYYYY}/{SEQ:4}',
  'INV/{YY}{MM}/{SEQ:4}',
  'INV-{DD}/{MM}/{YY}/{SEQ:3}',
  'INV/{MM}{FY}/{SEQ:3}',
  'S{YYYY}{MM}{SEQ:3}',
  '{DD}{MM}{FY}{SEQ:2}',
  '{SEQ:1}/{FY}',
];

const REJECTED: Array<[string, RegExp]> = [
  ['INV/{SEQ:4}', /must contain \{FY\} or \{FYYYY\}/],
  ['INV/{YY}/{SEQ:4}', /must contain \{FY\} or \{FYYYY\}/],
  ['INV/{YYYY}/{SEQ:4}', /must contain \{FY\} or \{FYYYY\}/],
  ['INV/{MM}/{SEQ:4}', /must also contain a year/],
  ['INV/{DD}/{SEQ:4}', /must also contain \{MM\} and a year/],
  ['{DD}/{MM}/{SEQ:4}', /must also contain \{MM\} and a year/],
  ['INV/{DD}{YY}/{SEQ:3}', /must also contain \{MM\} and a year/],
];

describe('MONEY-01: invoice number formats stay unique across counter resets', () => {
  it.each(ACCEPTED)('accepts %s and it never repeats a number over three financial years', (format) => {
    expect(validateInvoiceNumberFormat(format).valid).toBe(true);
    const numbers = issuedNumbers(format);
    expect(numbers.length).toBeGreaterThan(1500);
    expect(duplicates(numbers)).toEqual([]);
  });

  it.each(REJECTED)('rejects %s with a plain-English reason', (format, reason) => {
    const result = validateInvoiceNumberFormat(format);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(reason);
  });

  it.each(REJECTED)('the rejected format %s really would repeat a number (the rule is necessary)', (format) => {
    expect(duplicates(issuedNumbers(format)).length).toBeGreaterThan(0);
  });

  it('keeps the 16-character check first (a too-long format reports the length problem)', () => {
    const result = validateInvoiceNumberFormat('ABCDEFGHIJKL/{SEQ:6}');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('16-character legal limit');
  });

  it('maps the unique-number violation at finalize to DUPLICATE_INVOICE_NUMBER without leaking SQL', () => {
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: DB_CONSTRAINTS.INVOICES_BUSINESS_INVOICE_NUMBER_UNIQUE,
    });
    const mapped = mapKnownDatabaseError(pgError, FINALIZE_INVOICE_MAPPINGS);
    expect(mapped?.code).toBe('DUPLICATE_INVOICE_NUMBER');
    expect(mapped?.message).toContain('{FY}');
    expect(mapped?.message).not.toContain('invoices_business_id_invoice_number_unique');
    expect(mapped?.message).not.toContain('duplicate key');
  });

  it('the constraint name matches the migration that created it', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('drizzle/0000_melted_diamondback.sql', 'utf8');
    expect(sql).toContain(`CONSTRAINT "${DB_CONSTRAINTS.INVOICES_BUSINESS_INVOICE_NUMBER_UNIQUE}" UNIQUE("business_id","invoice_number")`);
  });
});
