import { describe, expect, it } from 'vitest';
import {
  addBillingCycleUtc,
  isBillingCycle,
  isPaidPlanName,
  resolveApprovalBase,
} from '@/lib/subscriptions/billing-period';

describe('billing-period (API-009)', () => {
  it('clamps Jan 31 + 1 month in non-leap year 2027 to Feb 28', () => {
    const base = new Date(Date.UTC(2027, 0, 31, 14, 30, 45, 123));
    const result = addBillingCycleUtc(base, 'monthly');
    expect(result.toISOString()).toBe('2027-02-28T14:30:45.123Z');
  });

  it('clamps Jan 31 + 1 month in leap year 2028 to Feb 29', () => {
    const base = new Date(Date.UTC(2028, 0, 31, 14, 30, 45, 123));
    const result = addBillingCycleUtc(base, 'monthly');
    expect(result.toISOString()).toBe('2028-02-29T14:30:45.123Z');
  });

  it('clamps Aug 31 + 1 month to Sep 30', () => {
    const base = new Date(Date.UTC(2026, 7, 31, 9, 15, 0, 0));
    const result = addBillingCycleUtc(base, 'monthly');
    expect(result.toISOString()).toBe('2026-09-30T09:15:00.000Z');
  });

  it('rolls Dec 31 + 1 month into Jan 31 next year', () => {
    const base = new Date(Date.UTC(2026, 11, 31, 23, 59, 59, 999));
    const result = addBillingCycleUtc(base, 'monthly');
    expect(result.toISOString()).toBe('2027-01-31T23:59:59.999Z');
  });

  it('clamps yearly from Feb 29 2028 to Feb 28 2029', () => {
    const base = new Date(Date.UTC(2028, 1, 29, 12, 0, 0, 0));
    const result = addBillingCycleUtc(base, 'yearly');
    expect(result.toISOString()).toBe('2029-02-28T12:00:00.000Z');
  });

  it('preserves exact time of day (hours, minutes, seconds, milliseconds)', () => {
    const base = new Date(Date.UTC(2026, 0, 15, 7, 18, 59, 876));
    const result = addBillingCycleUtc(base, 'monthly');
    expect(result.getUTCHours()).toBe(7);
    expect(result.getUTCMinutes()).toBe(18);
    expect(result.getUTCSeconds()).toBe(59);
    expect(result.getUTCMilliseconds()).toBe(876);
  });

  it('resolveApprovalBase preserves future expiry and falls back to now on past, invalid, or null', () => {
    const now = new Date('2026-10-15T12:00:00.000Z');
    const future = new Date('2026-10-25T12:00:00.000Z');
    const past = new Date('2026-10-05T12:00:00.000Z');

    expect(resolveApprovalBase(future, now).toISOString()).toBe('2026-10-25T12:00:00.000Z');
    expect(resolveApprovalBase('2026-10-25T12:00:00.000Z', now).toISOString()).toBe(
      '2026-10-25T12:00:00.000Z',
    );

    expect(resolveApprovalBase(past, now).toISOString()).toBe(now.toISOString());
    expect(resolveApprovalBase(now, now).toISOString()).toBe(now.toISOString());
    expect(resolveApprovalBase('garbage', now).toISOString()).toBe(now.toISOString());
    expect(resolveApprovalBase(null, now).toISOString()).toBe(now.toISOString());
  });

  it('isBillingCycle and isPaidPlanName guards enforce valid sets', () => {
    expect(isBillingCycle('monthly')).toBe(true);
    expect(isBillingCycle('yearly')).toBe(true);
    expect(isBillingCycle('daily')).toBe(false);
    expect(isBillingCycle('')).toBe(false);

    expect(isPaidPlanName('essentials')).toBe(true);
    expect(isPaidPlanName('professional')).toBe(true);
    expect(isPaidPlanName('free')).toBe(false);
    expect(isPaidPlanName('trial')).toBe(false);
    expect(isPaidPlanName('enterprise')).toBe(false);
  });
});

