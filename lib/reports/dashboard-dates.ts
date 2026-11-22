import { getIstDateParts, IST_OFFSET_MINUTES } from '@/lib/invoices/ist-date';
import { getCurrentFinancialYearRange } from '@/lib/reports/period';

/**
 * BUG-03: everything the dashboard derives from "now", in India time. Render runs in UTC, so the old
 * getFullYear()/getMonth()/getHours() calls gave "Good morning" until 5:30 pm IST and, from 00:00 to 05:30 IST on the
 * 1st, showed last month in the "this month" cards. Pure: same answer on the server and in the browser.
 */
export interface DashboardDates {
  /** First day of the chart window: the earlier of "11 months ago" and the start of the current FY. */
  readonly startDate: string;
  /** Last day of the current IST month. */
  readonly endDate: string;
  /** Current IST month, e.g. "2026-05". */
  readonly currentMonthKey: string;
  readonly greeting: 'Good morning' | 'Good afternoon' | 'Good evening';
}

const pad = (value: number): string => String(value).padStart(2, '0');

export function istHour(now: Date): number {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes() + IST_OFFSET_MINUTES;
  return Math.floor(minutes / 60) % 24;
}

export function getDashboardDates(now: Date = new Date()): DashboardDates {
  const { year, month } = getIstDateParts(now);

  // 11 months before the current IST month (12 months including this one), as a 1st-of-month date.
  const windowMonthIndex = year * 12 + (month - 1) - 11;
  const windowStart = `${Math.floor(windowMonthIndex / 12)}-${pad((windowMonthIndex % 12) + 1)}-01`;
  const fyStart = getCurrentFinancialYearRange(now).startDate;
  const startDate = windowStart < fyStart ? windowStart : fyStart;

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate = `${year}-${pad(month)}-${pad(lastDay)}`;

  const hour = istHour(now);
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return { startDate, endDate, currentMonthKey: `${year}-${pad(month)}`, greeting };
}
