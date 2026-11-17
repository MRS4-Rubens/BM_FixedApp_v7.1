import { describe, expect, it } from 'vitest';
import { computePlanPurchase } from '@/lib/subscriptions/plan-change';
import { addBillingCycleUtc } from '@/lib/subscriptions/billing-period';

const DAY = 86_400_000;
const NOW = new Date('2026-12-01T06:00:00.000Z');
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * DAY);

const active = (plan: string, endsAt: Date | string | null) => ({
  subscription_plan: plan,
  subscription_status: 'active',
  subscription_ends_at: endsAt,
});

describe('Feature G: computePlanPurchase (approved decisions 2-4)', () => {
  it('new: trial, free, expired, suspended or an already-ended plan start the paid cycle now', () => {
    const sources = [
      { subscription_plan: 'trial', subscription_status: 'trial', subscription_ends_at: null },
      { subscription_plan: 'free', subscription_status: 'active', subscription_ends_at: null },
      { subscription_plan: 'essentials', subscription_status: 'expired', subscription_ends_at: daysFromNow(30) },
      { subscription_plan: 'essentials', subscription_status: 'suspended', subscription_ends_at: daysFromNow(30) },
      active('essentials', daysFromNow(-1)),
      active('essentials', 'not-a-date'),
    ];
    for (const source of sources) {
      const result = computePlanPurchase(source, 'professional', 'monthly', NOW);
      expect(result.kind).toBe('new');
      expect(result.cycleStartsAt.getTime()).toBe(NOW.getTime());
      expect(result.endsAt).toEqual(addBillingCycleUtc(NOW, 'monthly'));
      expect(result.creditedMs).toBe(0);
    }
  });

  it('renewal: the same plan extends from the current expiry, unchanged from before', () => {
    const ends = daysFromNow(10);
    const result = computePlanPurchase(active('essentials', ends), 'essentials', 'yearly', NOW);
    expect(result).toMatchObject({ kind: 'renewal', fromPlan: 'essentials', unusedDays: 10, creditedDays: 0 });
    expect(result.endsAt).toEqual(addBillingCycleUtc(ends, 'yearly'));
  });

  it('upgrade: unused Essentials time is converted by value at the bought cycle\'s prices (monthly 399 -> 599)', () => {
    const result = computePlanPurchase(active('essentials', daysFromNow(300)), 'professional', 'monthly', NOW);
    // 300 days x 399/599 = 199.833... days -> credited 199 whole days (exact ms kept, rounded down).
    expect(result).toMatchObject({ kind: 'upgrade', fromPlan: 'essentials', unusedDays: 300, creditedDays: 199 });
    expect(result.creditedMs).toBe(Math.floor((300 * DAY * 399) / 599));
    expect(result.cycleStartsAt.getTime()).toBe(NOW.getTime() + result.creditedMs);
    expect(result.endsAt).toEqual(addBillingCycleUtc(result.cycleStartsAt, 'monthly'));
    // The bug this fixes: it must NOT be 300 days of Professional plus a month.
    expect(result.endsAt.getTime()).toBeLessThan(addBillingCycleUtc(daysFromNow(300), 'monthly').getTime());
  });

  it('upgrade on a yearly purchase uses the yearly prices (3,499 -> 4,999)', () => {
    const result = computePlanPurchase(active('essentials', daysFromNow(100)), 'professional', 'yearly', NOW);
    expect(result.creditedMs).toBe(Math.floor((100 * DAY * 349_900) / 499_900));
    expect(result.creditedDays).toBe(69); // 69.99 days
  });

  it('downgrade: unused Professional time becomes MORE Essentials time, never less value', () => {
    const result = computePlanPurchase(active('professional', daysFromNow(30)), 'essentials', 'monthly', NOW);
    // 30 days x 599/399 = 45.04 days
    expect(result).toMatchObject({ kind: 'downgrade', fromPlan: 'professional', unusedDays: 30, creditedDays: 45 });
    expect(result.creditedMs).toBe(Math.floor((30 * DAY * 599) / 399));
  });

  it('never credits more value than it had: value(credited at new price) <= value(unused at old price)', () => {
    for (const unusedDays of [0.0001, 1, 7.5, 29, 365, 730]) {
      for (const [from, to] of [['essentials', 'professional'], ['professional', 'essentials']] as const) {
        for (const cycle of ['monthly', 'yearly'] as const) {
          const result = computePlanPurchase(active(from, new Date(NOW.getTime() + unusedDays * DAY)), to, cycle, NOW);
          const priceOf = (plan: string) =>
            plan === 'essentials' ? (cycle === 'yearly' ? 349_900 : 39_900) : cycle === 'yearly' ? 499_900 : 59_900;
          const before = BigInt(result.unusedMs) * BigInt(priceOf(from));
          const after = BigInt(result.creditedMs) * BigInt(priceOf(to));
          expect(after <= before).toBe(true);
          expect(before - after < BigInt(priceOf(to))).toBe(true); // lost at most 1 ms of value to rounding
        }
      }
    }
  });

  it('accepts an ISO string expiry (as stored) and handles 10 years of unused time without overflow', () => {
    const result = computePlanPurchase(active('essentials', daysFromNow(3650).toISOString()), 'professional', 'yearly', NOW);
    expect(result.kind).toBe('upgrade');
    expect(Number.isSafeInteger(result.creditedMs)).toBe(true);
    expect(result.creditedMs).toBe(Number((BigInt(3650 * DAY) * 349_900n) / 499_900n));
  });
});
