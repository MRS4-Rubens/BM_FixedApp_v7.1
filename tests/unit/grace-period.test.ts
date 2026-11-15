import { describe, expect, it } from 'vitest';
import { computeGraceEndsAt, GRACE_HOURS } from '@/lib/subscriptions/grace-period';
import { assertOverrideCoherent } from '@/lib/validations/admin-subscription';

describe('computeGraceEndsAt', () => {
  it('computes now + 48h exactly when current expiry is null', () => {
    const now = new Date('2026-11-16T10:00:00.000Z');
    const result = computeGraceEndsAt(null, now);
    expect(result.getTime()).toBe(now.getTime() + GRACE_HOURS * 3_600_000);
  });

  it('computes now + 48h when current expiry is in the past', () => {
    const now = new Date('2026-11-16T10:00:00.000Z');
    const past = new Date('2026-11-10T10:00:00.000Z');
    const result = computeGraceEndsAt(past, now);
    expect(result.getTime()).toBe(now.getTime() + GRACE_HOURS * 3_600_000);
  });

  it('computes current + 48h when current expiry is in the future (never shortens)', () => {
    const now = new Date('2026-11-16T10:00:00.000Z');
    const future = new Date('2027-09-12T10:00:00.000Z'); // now + 300 days
    const result = computeGraceEndsAt(future, now);
    expect(result.getTime()).toBe(future.getTime() + GRACE_HOURS * 3_600_000);
    expect(result.getTime()).toBeGreaterThan(future.getTime());
  });

  it('respects custom hours argument', () => {
    const now = new Date('2026-11-16T10:00:00.000Z');
    const customHours = 72;
    const result = computeGraceEndsAt(null, now, customHours);
    expect(result.getTime()).toBe(now.getTime() + 72 * 3_600_000);
  });

  // The admin grace preset keeps status "trial" for the Trial plan and "active" for paid plans;
  // both combinations must pass the server's override rule (a Trial plan can never be "active").
  it('produces overrides the server accepts for trial and paid plans', () => {
    const now = new Date('2026-11-16T10:00:00.000Z');
    const endsAt = computeGraceEndsAt(null, now);
    expect(() => assertOverrideCoherent({ plan: 'trial', status: 'trial', endsAt, now })).not.toThrow();
    expect(() => assertOverrideCoherent({ plan: 'essentials', status: 'active', endsAt, now })).not.toThrow();
    expect(() => assertOverrideCoherent({ plan: 'trial', status: 'active', endsAt, now })).toThrow();
  });
});
