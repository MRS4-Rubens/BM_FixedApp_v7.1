import { formatIstDateAsIso } from '@/lib/invoices/ist-date';

/** Calendar arithmetic on "YYYY-MM-DD" strings (IST calendar dates): no time-of-day or time-zone surprises. */

export function istTodayIso(now: Date): string {
  return formatIstDateAsIso(now);
}

function toUtcMidnight(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(toUtcMidnight(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` (positive when `toIso` is later). */
export function diffDaysIso(fromIso: string, toIso: string): number {
  return Math.round((toUtcMidnight(toIso) - toUtcMidnight(fromIso)) / 86_400_000);
}

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export function monthLong(month: number): string {
  return MONTHS_LONG[month - 1] ?? '';
}

export function monthShort(month: number): string {
  return MONTHS_SHORT[month - 1] ?? '';
}

/** "2026-11-20" -> "20 Nov 2026" */
export function formatIsoDateShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${monthShort(m)} ${y}`;
}
