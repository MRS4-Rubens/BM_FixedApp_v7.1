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
 *  - at most INVOICE_BACKDATE_WINDOW_DAYS (30) days in the past, the same back-dating limit invoices have;
 *  - MONEY-09: not after the CGST Act section 34(2) deadline for the original invoice (see creditNoteDeadlineIso).
 */
export type CreditNoteDateRejection =
  | 'CREDIT_NOTE_DATE_INVALID'
  | 'CREDIT_NOTE_DATE_FUTURE'
  | 'CREDIT_NOTE_DATE_BEFORE_INVOICE'
  | 'CREDIT_NOTE_DATE_CROSS_FY'
  | 'CREDIT_NOTE_DATE_TOO_OLD'
  | 'CREDIT_NOTE_PAST_DEADLINE';

export type CreditNoteDateDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: CreditNoteDateRejection; readonly message: string };

function display(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * MONEY-09: CGST Act section 34(2) — a credit note that reduces GST must be declared not later than 30 November
 * following the end of the financial year in which the supply was made (or the date the annual return for that year is
 * filed, if earlier; the app cannot know that date, so the screen message mentions it). Example: an invoice of
 * 15-Jan-2027 (FY 2026-27, ending 31-Mar-2027) can be credited up to 30-Nov-2027.
 */
export function creditNoteDeadlineIso(originalInvoiceDateIso: string): string {
  const fy = getIndianFinancialYearForDate(parseIsoDateToIstDate(originalInvoiceDateIso));
  const fyEndYear = fy.endDate.getUTCFullYear();
  return `${fyEndYear}-11-30`;
}

/** The message shown when the deadline has passed (also used before the form opens). */
export function creditNoteDeadlineMessage(originalInvoiceDateIso: string): string {
  return `The GST deadline for credit notes on this invoice ended on ${display(creditNoteDeadlineIso(originalInvoiceDateIso))} (CGST Act section 34: 30 November after the invoice's financial year, or earlier if the annual return for that year was already filed). Settle any refund or discount outside GST and talk to your accountant.`;
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
  if (
    originalInvoiceDateIso !== null &&
    isValidIsoCalendarDate(originalInvoiceDateIso) &&
    // The note is reported when it is finalized, so TODAY decides (a back-dated note does not extend the deadline);
    // the issue date can never be after today (checked above), so this also covers it.
    todayIso > creditNoteDeadlineIso(originalInvoiceDateIso)
  ) {
    return { ok: false, code: 'CREDIT_NOTE_PAST_DEADLINE', message: creditNoteDeadlineMessage(originalInvoiceDateIso) };
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
