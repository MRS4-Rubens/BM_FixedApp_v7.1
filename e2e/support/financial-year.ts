/**
 * Independent Indian Financial Year (IST) oracle for E2E tests.
 * Resolves dates in the Asia/Kolkata timezone (UTC+05:30).
 */

const IST_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hour12: false,
});

export interface IstDateParts {
  readonly year: number;
  readonly month: number; // 1 - 12
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export function parseDateToIstParts(date: Date | string | number): IstDateParts {
  const d = typeof date === 'object' ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    throw new RangeError(`Invalid date provided: ${date}`);
  }

  const parts = IST_DATE_FORMATTER.formatToParts(d);
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;

  for (const part of parts) {
    if (part.type === 'year') year = parseInt(part.value, 10);
    else if (part.type === 'month') month = parseInt(part.value, 10);
    else if (part.type === 'day') day = parseInt(part.value, 10);
    else if (part.type === 'hour') hour = parseInt(part.value, 10);
    else if (part.type === 'minute') minute = parseInt(part.value, 10);
    else if (part.type === 'second') second = parseInt(part.value, 10);
  }

  return { year, month, day, hour, minute, second };
}

/**
 * Returns the Indian Financial Year label (e.g. "2026-27") for a given date in IST.
 * Financial Year starts April 1st and ends March 31st IST.
 */
export function getIndianFinancialYear(date: Date | string | number = new Date()): string {
  const { year, month } = parseDateToIstParts(date);
  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;
  const endYearSuffix = String(endYear).slice(-2);
  return `${startYear}-${endYearSuffix}`;
}

/**
 * Returns a regex matching the default invoice number format:
 * `^INV/<FY>/<SEQ:4>$` (e.g. `^INV/2026-27/0001$`).
 */
export function getExpectedInvoiceNumberPattern(
  sequence = 1,
  fyLabel?: string,
): RegExp {
  const fy = fyLabel ?? getIndianFinancialYear();
  const seqStr = String(sequence).padStart(4, '0');
  const escapedFy = fy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^INV/${escapedFy}/${seqStr}$`);
}

