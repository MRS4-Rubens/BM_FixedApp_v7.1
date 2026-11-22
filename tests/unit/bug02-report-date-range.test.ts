import { describe, expect, it, vi } from 'vitest';

// The actions validate their input before any session or database work, so bad ranges are refused without either.
vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => {
    throw new Error('validation must fail before the session is read');
  },
}));

import { getSalesByPeriod } from '@/lib/actions/reports/get-sales-by-period';
import { getTopCustomers } from '@/lib/actions/reports/get-top-customers';
import { getTopProducts } from '@/lib/actions/reports/get-top-products';
import { REPORT_MAX_RANGE_DAYS, reportRangeMessage, reportRangeProblem } from '@/lib/reports/date-range';
import { getDashboardDates } from '@/lib/reports/dashboard-dates';
import { getCurrentFinancialYearRange, getPreviousFinancialYearRange } from '@/lib/reports/period';
import { reportRangeSchema } from '@/lib/validations/report-range';

describe('BUG-02: report date ranges', () => {
  it('only real calendar dates between 2017 and 2100, in order, at most 366 days', () => {
    expect(REPORT_MAX_RANGE_DAYS).toBe(366);
    expect(reportRangeProblem('2026-11-01', '2026-11-30')).toBeNull();
    expect(reportRangeProblem('2026-11-22', '2026-11-22')).toBeNull(); // a single day
    expect(reportRangeProblem('2024-01-01', '2024-12-31')).toBeNull(); // 366 days (leap year)
    expect(reportRangeProblem('2025-01-01', '2026-01-01')).toBeNull(); // 366 days
    expect(reportRangeProblem('2025-01-01', '2026-01-02')).toBe('too_long'); // 367 days
    expect(reportRangeProblem('0001-01-01', '9999-12-31')).toBe('invalid_date');
    expect(reportRangeProblem('2016-12-31', '2017-01-31')).toBe('invalid_date');
    expect(reportRangeProblem('2026-02-01', '2026-02-30')).toBe('invalid_date');
    expect(reportRangeProblem('2026-13-01', '2026-12-01')).toBe('invalid_date');
    expect(reportRangeProblem('', '2026-12-01')).toBe('invalid_date');
    expect(reportRangeProblem('2026-12-01', '2026-11-30')).toBe('end_before_start');
    expect(reportRangeMessage('too_long')).toBe('Date range cannot exceed 366 days');
    expect(reportRangeMessage('invalid_date')).toBe('Pick real dates between 2017 and 2100');
  });

  it('every window the app builds itself stays valid: this/previous FY and the dashboard chart, leap years included', () => {
    for (let year = 2025; year <= 2030; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const now = new Date(Date.UTC(year, month - 1, 15, 6));
        const fy = getCurrentFinancialYearRange(now);
        const prev = getPreviousFinancialYearRange(now);
        const dashboard = getDashboardDates(now);
        expect(reportRangeProblem(fy.startDate, fy.endDate), `FY at ${year}-${month}`).toBeNull();
        expect(reportRangeProblem(prev.startDate, prev.endDate), `previous FY at ${year}-${month}`).toBeNull();
        expect(reportRangeProblem(dashboard.startDate, dashboard.endDate), `dashboard at ${year}-${month}`).toBeNull();
      }
    }
  });

  it('the shared schema puts order and length problems on endDate', () => {
    const tooLong = reportRangeSchema.safeParse({ startDate: '2024-01-01', endDate: '2025-01-02' });
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['endDate', 'Date range cannot exceed 366 days'],
    ]);
    expect(reportRangeSchema.safeParse({ startDate: '2026-02-30', endDate: '2026-03-01' }).success).toBe(false);
    expect(reportRangeSchema.safeParse({ startDate: '2026-04-01', endDate: '2027-03-31' }).success).toBe(true);
  });

  it('the Reports actions refuse impossible dates and runaway ranges before touching the session or database', async () => {
    const huge = { startDate: '0001-01-01', endDate: '9999-12-31' };
    const impossible = { startDate: '2026-02-01', endDate: '2026-02-30' };
    const tooLong = { startDate: '2017-07-01', endDate: '2026-11-22' };
    for (const input of [huge, impossible, tooLong]) {
      for (const result of [
        await getSalesByPeriod(input),
        await getTopCustomers(input),
        await getTopProducts(input),
      ]) {
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    }
    const badLimit = await getTopCustomers({ startDate: '2026-11-01', endDate: '2026-11-30', limit: 100_000 });
    expect(badLimit.success).toBe(false);
  });
});
