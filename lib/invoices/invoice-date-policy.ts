import { getIndianFinancialYearForDate } from './financial-year';
import { parseIsoDateToIstDate } from './ist-date';

export const INVOICE_BACKDATE_WINDOW_DAYS = 30; // documented policy constant — see ARCHITECTURE.md

export type InvoiceDateRejection =
  | 'INVOICE_DATE_INVALID'
  | 'INVOICE_DATE_FUTURE'
  | 'INVOICE_DATE_TOO_OLD'
  | 'INVOICE_DATE_CROSS_FY';

export type InvoiceDateDecision =
  | { ok: true }
  | { ok: false; code: InvoiceDateRejection; message: string };

function formatIsoToDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Strict ISO calendar date validation: rejects invalid format, non-existent dates
 * like 2026-02-31, and non-leap 02-29.
 */
export function isValidIsoCalendarDate(iso: string): boolean {
  if (typeof iso !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCFullYear(year);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function evaluateInvoiceDate(args: {
  invoiceDateIso: string;
  todayIso: string;
  latestFinalizedDateIso: string | null;
  confirmCrossFinancialYear: boolean;
  windowDays?: number;
}): InvoiceDateDecision {
  const {
    invoiceDateIso,
    todayIso,
    latestFinalizedDateIso,
    confirmCrossFinancialYear,
    windowDays = INVOICE_BACKDATE_WINDOW_DAYS,
  } = args;

  // 1. Invalid calendar date
  if (!isValidIsoCalendarDate(invoiceDateIso) || !isValidIsoCalendarDate(todayIso)) {
    return {
      ok: false,
      code: 'INVOICE_DATE_INVALID',
      message: 'Invalid calendar date format or non-existent date.',
    };
  }

  // 2. Future date in IST
  if (invoiceDateIso > todayIso) {
    return {
      ok: false,
      code: 'INVOICE_DATE_FUTURE',
      message: `Invoice date cannot be in the future. Today (IST) is ${formatIsoToDisplayDate(todayIso)}.`,
    };
  }

  // 3. Cross financial year check
  const invoiceDate = parseIsoDateToIstDate(invoiceDateIso);
  const todayDate = parseIsoDateToIstDate(todayIso);
  const invoiceFy = getIndianFinancialYearForDate(invoiceDate);
  const todayFy = getIndianFinancialYearForDate(todayDate);

  if (invoiceFy.label !== todayFy.label && !confirmCrossFinancialYear) {
    return {
      ok: false,
      code: 'INVOICE_DATE_CROSS_FY',
      message: `The invoice date falls in financial year ${invoiceFy.label}, but the current financial year is ${todayFy.label}. Confirmation is required to finalize an invoice across financial years.`,
    };
  }

  // 4. Backdate window check (relative to latest finalized invoice in the series)
  if (latestFinalizedDateIso !== null) {
    if (!isValidIsoCalendarDate(latestFinalizedDateIso)) {
      return {
        ok: false,
        code: 'INVOICE_DATE_INVALID',
        message: 'Invalid latest finalized invoice date.',
      };
    }

    const latestUtcMillis = parseIsoDateToIstDate(latestFinalizedDateIso).getTime();
    const earliestUtcMillis = latestUtcMillis - windowDays * 86_400_000;
    const earliestIso = new Date(earliestUtcMillis).toISOString().slice(0, 10);

    if (invoiceDateIso < earliestIso) {
      return {
        ok: false,
        code: 'INVOICE_DATE_TOO_OLD',
        message: `Invoice date cannot be earlier than ${formatIsoToDisplayDate(earliestIso)} (maximum backdate window is ${windowDays} days from the latest finalized invoice on ${formatIsoToDisplayDate(latestFinalizedDateIso)}).`,
      };
    }
  }

  return { ok: true };
}
