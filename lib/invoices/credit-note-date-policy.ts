import { getIndianFinancialYearForDate } from './financial-year';
import { INVOICE_BACKDATE_WINDOW_DAYS, isValidIsoCalendarDate } from './invoice-date-policy';
import { parseIsoDateToIstDate } from './ist-date';

/**
 * MONEY-08: the server-side rule for a credit note's issue date. The app's form never sends a date (a credit note is
 * dated the day it is finalized), so this guards hand-made requests that would otherwise put a credit note in another
 * financial year (its number series and GSTR-1 period come from this date).
 *
 * A credit note date must be a real calendar date that is:
 *  - not in the future (India time);
 *  - not before the original invoice's date;
 *  - in the current financial year;
 *  - at most INVOICE_BACKDATE_WINDOW_DAYS (30) days in the past, the same back-dating limit invoices have.
 */
export type CreditNoteDateRejection =
  | 'CREDIT_NOTE_DATE_INVALID'
  | 'CREDIT_NOTE_DATE_FUTURE'
  | 'CREDIT_NOTE_DATE_BEFORE_INVOICE'
  | 'CREDIT_NOTE_DATE_CROSS_FY'
  | 'CREDIT_NOTE_DATE_TOO_OLD';

export type CreditNoteDateDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: CreditNoteDateRejection; readonly message: string };

function display(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function addDays(iso: string, days: number): string {
  return new Date(parseIsoDateToIstDate(iso).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function evaluateCreditNoteDate(args: {
  readonly issueDateIso: string;
  readonly todayIso: string;
  /** The original invoice's date; null only for legacy rows without one (then that check is skipped). */
  readonly originalInvoiceDateIso: string | null;
  readonly windowDays?: number;
}): CreditNoteDateDecision {
  const { issueDateIso, todayIso, originalInvoiceDateIso, windowDays = INVOICE_BACKDATE_WINDOW_DAYS } = args;

  if (!isValidIsoCalendarDate(issueDateIso) || !isValidIsoCalendarDate(todayIso)) {
    return { ok: false, code: 'CREDIT_NOTE_DATE_INVALID', message: 'The credit note date is not a valid calendar date.' };
  }
  if (issueDateIso > todayIso) {
    return {
      ok: false,
      code: 'CREDIT_NOTE_DATE_FUTURE',
      message: `A credit note cannot be dated in the future. Today (IST) is ${display(todayIso)}.`,
    };
  }
  if (originalInvoiceDateIso !== null && isValidIsoCalendarDate(originalInvoiceDateIso) && issueDateIso < originalInvoiceDateIso) {
    return {
      ok: false,
      code: 'CREDIT_NOTE_DATE_BEFORE_INVOICE',
      message: `A credit note cannot be dated before its invoice (${display(originalInvoiceDateIso)}).`,
    };
  }
  const issueFy = getIndianFinancialYearForDate(parseIsoDateToIstDate(issueDateIso)).label;
  const todayFy = getIndianFinancialYearForDate(parseIsoDateToIstDate(todayIso)).label;
  if (issueFy !== todayFy) {
    return {
      ok: false,
      code: 'CREDIT_NOTE_DATE_CROSS_FY',
      message: `A credit note must be dated in the current financial year (${todayFy}).`,
    };
  }
  const earliestIso = addDays(todayIso, -windowDays);
  if (issueDateIso < earliestIso) {
    return {
      ok: false,
      code: 'CREDIT_NOTE_DATE_TOO_OLD',
      message: `A credit note cannot be dated earlier than ${display(earliestIso)} (at most ${windowDays} days back).`,
    };
  }
  return { ok: true };
}
