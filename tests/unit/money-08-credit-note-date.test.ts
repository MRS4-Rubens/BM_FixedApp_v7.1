import { describe, expect, it } from 'vitest';
import { creditNoteDeadlineIso, creditNoteDeadlineMessage, evaluateCreditNoteDate } from '@/lib/invoices/credit-note-date-policy';

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

/** MONEY-09: CGST Act section 34(2) — 30 November after the end of the invoice's financial year. */
describe('credit-note deadline (section 34)', () => {
  it('is 30 November after the financial year of the invoice', () => {
    expect(creditNoteDeadlineIso('2026-04-01')).toBe('2027-11-30'); // FY 2026-27
    expect(creditNoteDeadlineIso('2027-03-31')).toBe('2027-11-30'); // still FY 2026-27
    expect(creditNoteDeadlineIso('2027-04-01')).toBe('2028-11-30'); // FY 2027-28
    expect(creditNoteDeadlineMessage('2026-06-15')).toContain('30/11/2027');
  });

  it('allows a credit note on the deadline day and refuses it the day after', () => {
    const check = (today: string) =>
      evaluateCreditNoteDate({ issueDateIso: today, todayIso: today, originalInvoiceDateIso: '2026-06-15' });
    expect(check('2027-11-30').ok).toBe(true);
    const late = check('2027-12-01');
    expect(late.ok ? 'OK' : late.code).toBe('CREDIT_NOTE_PAST_DEADLINE');
    expect(late.ok ? '' : late.message).toContain('section 34');
  });

  it('a back-dated note finalized after the deadline is refused too (today decides)', () => {
    const decide = (issueDateIso: string, todayIso: string) =>
      evaluateCreditNoteDate({ issueDateIso, todayIso, originalInvoiceDateIso: '2026-06-15' });
    const late = decide('2027-11-30', '2027-12-01');
    expect(late.ok ? 'OK' : late.code).toBe('CREDIT_NOTE_PAST_DEADLINE');
    expect(decide('2027-11-25', '2027-11-30').ok).toBe(true); // back-dated within the deadline still passes
  });
});
