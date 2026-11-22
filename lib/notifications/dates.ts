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

/** True for a real calendar date written as "YYYY-MM-DD" ("2026-02-30" and "2026-13-01" are false). */
export function isIsoCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && addDaysIso(value, 0) === value;
}

/**
 * BUG-01: the IST days one daily run must cover, oldest first, ending with today.
 * - No earlier run on record (first run ever, or an unreadable record) → today only: never a flood of old items.
 * - The last completed run was today or "later" (a re-run, or a clock that went backwards) → today only.
 * - Otherwise every day after the last completed run, but never more than `maxDays` days (today included).
 */
export function catchUpDaysIso(lastRunIso: string | null, todayIso: string, maxDays: number): string[] {
  if (lastRunIso === null || !isIsoCalendarDate(lastRunIso)) return [todayIso];
  const missed = diffDaysIso(lastRunIso, todayIso);
  if (missed <= 0) return [todayIso];
  const count = Math.min(missed, Math.max(1, maxDays));
  return Array.from({ length: count }, (_, index) => addDaysIso(todayIso, index - count + 1));
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
