export const IST_OFFSET_MINUTES = 5 * 60 + 30; // India Standard Time is a fixed UTC+5:30 with no daylight saving — safe to hardcode permanently, this will never change.

export interface IstDateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

// This is the single source of truth for 'what calendar date is it, for GST invoicing purposes' anywhere in this app. Never call .getFullYear()/.getMonth()/.getDate() (server-local time, which varies by deployment) or .getUTCFullYear() alone (which is 5.5 hours behind India) directly for invoice-numbering or invoice-date purposes — always go through this file instead.
export function getIstDateParts(date: Date): IstDateParts {
  const istMillis = date.getTime() + IST_OFFSET_MINUTES * 60 * 1000;
  const shifted = new Date(istMillis);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export const IST_TIME_ZONE = 'Asia/Kolkata';

/**
 * Human-readable date in India time, e.g. "7/11/2026" (en-IN default) or with `options`
 * ({ day: '2-digit', month: 'short', year: 'numeric' } -> "07 Nov 2026").
 *
 * Use this instead of `toLocaleDateString` in anything that renders: the server runs in UTC and the browser
 * in the user's zone, so an unzoned format can print different days on each side (React hydration error #418)
 * and briefly show the wrong date. Fixing the zone to IST makes server and browser output identical.
 */
export function formatIstDate(value: Date | string | number, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, ...options }).format(new Date(value));
}

/** Time of day in India time, e.g. "01:36 am". Same hydration rationale as {@link formatIstDate}. */
export function formatIstTime(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' },
): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, ...options }).format(new Date(value));
}

export function formatIstDateAsIso(date: Date): string {
  const { year, month, day } = getIstDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseIsoDateToIstDate(isoStr: string): Date {
  const [yyyy, mm, dd] = isoStr.split('-').map(Number);
  return new Date(Date.UTC(yyyy, mm - 1, dd));
}

/** Strict calendar validation: rejects 2026-02-31, 2026-13-01 and non-leap 02-29 (Date.parse accepts the first). */
export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCFullYear(year);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

