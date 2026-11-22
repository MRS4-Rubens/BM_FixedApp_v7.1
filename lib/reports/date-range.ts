import { isValidIsoDate } from '@/lib/invoices/ist-date';
import { EXPORT_MAX_RANGE_DAYS, ISO_DATE_MAX_YEAR, ISO_DATE_MIN_YEAR } from '@/lib/validations/limits';

/**
 * BUG-02: one rule for every report window (Reports page, dashboard chart, Excel exports), pure and browser-safe.
 * The longest window is one financial year plus a leap day, the same limit the Excel exports always had, so any window
 * the page can show can also be exported.
 */
export const REPORT_MAX_RANGE_DAYS = EXPORT_MAX_RANGE_DAYS;

export type ReportRangeProblem = 'invalid_date' | 'end_before_start' | 'too_long';

const MS_PER_DAY = 86_400_000;

function isReportDate(value: string): boolean {
  if (!isValidIsoDate(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= ISO_DATE_MIN_YEAR && year <= ISO_DATE_MAX_YEAR;
}

/** Why `startDate`..`endDate` ("YYYY-MM-DD", both inclusive) cannot be used as a report window, or null when it can. */
export function reportRangeProblem(startDate: string, endDate: string): ReportRangeProblem | null {
  if (!isReportDate(startDate) || !isReportDate(endDate)) return 'invalid_date';
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / MS_PER_DAY + 1;
  if (days < 1) return 'end_before_start';
  if (days > REPORT_MAX_RANGE_DAYS) return 'too_long';
  return null;
}

/** One short sentence without a final full stop (callers add their own punctuation). */
export function reportRangeMessage(problem: ReportRangeProblem): string {
  switch (problem) {
    case 'invalid_date':
      return `Pick real dates between ${ISO_DATE_MIN_YEAR} and ${ISO_DATE_MAX_YEAR}`;
    case 'end_before_start':
      return 'End date cannot be before start date';
    case 'too_long':
      return `Date range cannot exceed ${REPORT_MAX_RANGE_DAYS} days`;
  }
}
