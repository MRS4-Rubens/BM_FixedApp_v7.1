import { describe, expect, it } from 'vitest';
import { getDashboardDates, istHour } from '@/lib/reports/dashboard-dates';
import { addBillingCycleUtc, addMonthsClampedUtc } from '@/lib/subscriptions/billing-period';

/** BUG-03: Render runs in UTC; everything the dashboard shows about "now" must be in India time (UTC+5:30). */
describe('BUG-03: dashboard dates in IST', () => {
  it('on the 1st of a month before 05:30 IST, "this month" is already the new month', () => {
    // 2026-04-30T20:00Z = 1 May 2026, 01:30 IST
    const dates = getDashboardDates(new Date('2026-04-30T20:00:00Z'));
    expect(dates.currentMonthKey).toBe('2026-05');
    expect(dates.endDate).toBe('2026-05-31');
  });

  it('the chart window starts 11 months back or at the FY start, whichever is earlier', () => {
    // 22 Nov 2026 IST: 11 months back = Dec 2025, FY start = 1 Apr 2026 → Dec 2025.
    expect(getDashboardDates(new Date('2026-11-22T06:00:00Z')).startDate).toBe('2025-12-01');
    // 1 May 2026 IST (just after midnight): 11 months back = Jun 2025, FY start = 1 Apr 2026 → Jun 2025.
    expect(getDashboardDates(new Date('2026-04-30T20:00:00Z')).startDate).toBe('2025-06-01');
  });

  it('greets by the IST hour (the old code used the UTC hour on the server)', () => {
    expect(getDashboardDates(new Date('2026-11-22T07:30:00Z')).greeting).toBe('Good afternoon'); // 13:00 IST
    expect(getDashboardDates(new Date('2026-11-22T03:00:00Z')).greeting).toBe('Good morning'); // 08:30 IST
    expect(getDashboardDates(new Date('2026-11-22T12:00:00Z')).greeting).toBe('Good evening'); // 17:30 IST
    expect(getDashboardDates(new Date('2026-11-22T06:29:00Z')).greeting).toBe('Good morning'); // 11:59 IST
    expect(getDashboardDates(new Date('2026-11-22T06:30:00Z')).greeting).toBe('Good afternoon'); // 12:00 IST
  });

  it('istHour wraps past midnight', () => {
    expect(istHour(new Date('2026-11-22T18:30:00Z'))).toBe(0); // 00:00 IST next day
    expect(istHour(new Date('2026-11-22T20:15:00Z'))).toBe(1); // 01:45 IST
  });

  it('handles a leap-year February as the current month', () => {
    expect(getDashboardDates(new Date('2028-02-10T06:00:00Z')).endDate).toBe('2028-02-29');
  });
});

describe('BUG-03: expiry previews use the same month-end clamp as the server', () => {
  it('31 Jan + 1 month = 28 Feb (not 3 Mar), 29 Feb in a leap year', () => {
    expect(addMonthsClampedUtc(new Date(Date.UTC(2027, 0, 31)), 1).toISOString().slice(0, 10)).toBe('2027-02-28');
    expect(addMonthsClampedUtc(new Date(Date.UTC(2028, 0, 31)), 1).toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('adds several months across a year boundary', () => {
    expect(addMonthsClampedUtc(new Date(Date.UTC(2026, 10, 30)), 3).toISOString().slice(0, 10)).toBe('2027-02-28');
    expect(addMonthsClampedUtc(new Date(Date.UTC(2026, 7, 31)), 6).toISOString().slice(0, 10)).toBe('2027-02-28');
  });

  it('addBillingCycleUtc is unchanged (monthly = 1, yearly = 12 months, time of day kept)', () => {
    const base = new Date('2027-01-31T10:15:00Z');
    expect(addBillingCycleUtc(base, 'monthly').toISOString()).toBe('2027-02-28T10:15:00.000Z');
    expect(addBillingCycleUtc(new Date('2028-02-29T00:00:00Z'), 'yearly').toISOString()).toBe('2029-02-28T00:00:00.000Z');
  });
});
