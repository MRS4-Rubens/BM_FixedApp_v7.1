import { describe, expect, it } from 'vitest';
import { evaluateCreditNoteDate } from '@/lib/invoices/credit-note-date-policy';

/** MONEY-08: the server-side rule for a credit note's issue date. */
describe('evaluateCreditNoteDate', () => {
  const today = '2026-11-22';
  const check = (issueDateIso: string, originalInvoiceDateIso: string | null = '2026-10-01', todayIso = today) =>
    evaluateCreditNoteDate({ issueDateIso, todayIso, originalInvoiceDateIso });
  const code = (decision: ReturnType<typeof check>) => (decision.ok ? 'OK' : decision.code);

  it('accepts today, the invoice day itself and up to 30 days back', () => {
    expect(code(check(today))).toBe('OK');
    expect(code(check('2026-11-01', '2026-11-01'))).toBe('OK');
    expect(code(check('2026-10-23'))).toBe('OK'); // exactly 30 days back
  });

  it('refuses impossible, future, before-invoice, other-FY and too-old dates', () => {
    expect(code(check('2026-02-30'))).toBe('CREDIT_NOTE_DATE_INVALID');
    expect(code(check('2026-11-23'))).toBe('CREDIT_NOTE_DATE_FUTURE');
    expect(code(check('2026-09-30'))).toBe('CREDIT_NOTE_DATE_BEFORE_INVOICE');
    expect(code(check('2026-10-22'))).toBe('CREDIT_NOTE_DATE_TOO_OLD'); // 31 days back
    // Early April: a 31 March date is in the previous financial year even though it is within 30 days.
    expect(code(check('2027-03-31', '2027-03-01', '2027-04-02'))).toBe('CREDIT_NOTE_DATE_CROSS_FY');
    expect(code(check('2027-04-01', '2027-03-01', '2027-04-02'))).toBe('OK');
  });

  it('skips the invoice-date check only for legacy invoices without a date; messages are user-facing', () => {
    expect(code(check('2026-11-20', null))).toBe('OK');
    const future = check('2026-12-01');
    expect(future.ok ? '' : future.message).toBe('A credit note cannot be dated in the future. Today (IST) is 22/11/2026.');
    const before = check('2026-09-30');
    expect(before.ok ? '' : before.message).toBe('A credit note cannot be dated before its invoice (01/10/2026).');
  });
});
