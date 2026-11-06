import { describe, expect, it } from 'vitest';
import { ActionError } from '@/lib/actions/_shared/errors';
import { assertNotSuspended } from '@/lib/actions/_shared/subscription-guard';
import {
  canCreateInvoice,
  checkAccountNotSuspended,
  getPlanEntitlements,
  type BusinessSubscriptionSource,
} from '@/lib/subscriptions/entitlements';

describe('API-010: Entitlements and suspension pure logic', () => {
  it('trial with NULL trial_ends_at resolves fail-closed to free/expired/0 days remaining', () => {
    const biz: BusinessSubscriptionSource = {
      subscription_plan: 'trial',
      subscription_status: 'trial',
      trial_ends_at: null,
      subscription_ends_at: null,
    };
    const entitlements = getPlanEntitlements(biz);
    expect(entitlements.tier).toBe('free');
    expect(entitlements.rawStatus).toBe('expired');
    expect(entitlements.daysRemaining).toBe(0);
    expect(entitlements.isExpired).toBe(true);
    expect(entitlements.isTrial).toBe(false);
  });

  it('trial with future trial_ends_at resolves to trial tier and active trial status', () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const biz: BusinessSubscriptionSource = {
      subscription_plan: 'trial',
      subscription_status: 'trial',
      trial_ends_at: futureDate,
      subscription_ends_at: null,
    };
    const entitlements = getPlanEntitlements(biz);
    expect(entitlements.tier).toBe('trial');
    expect(entitlements.rawStatus).toBe('trial');
    expect(entitlements.isTrial).toBe(true);
    expect(entitlements.isExpired).toBe(false);
    expect(entitlements.daysRemaining).toBeGreaterThan(0);
  });

  it('trial with past trial_ends_at resolves to free tier and expired status', () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const biz: BusinessSubscriptionSource = {
      subscription_plan: 'trial',
      subscription_status: 'trial',
      trial_ends_at: pastDate,
      subscription_ends_at: null,
    };
    const entitlements = getPlanEntitlements(biz);
    expect(entitlements.tier).toBe('free');
    expect(entitlements.rawStatus).toBe('expired');
    expect(entitlements.daysRemaining).toBe(0);
    expect(entitlements.isExpired).toBe(true);
  });

  it('checkAccountNotSuspended denies suspended business with ACCOUNT_SUSPENDED code', () => {
    const suspendedBiz: BusinessSubscriptionSource = {
      subscription_plan: 'essentials',
      subscription_status: 'suspended',
      trial_ends_at: null,
      subscription_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
    const result = checkAccountNotSuspended(suspendedBiz);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('ACCOUNT_SUSPENDED');
    expect(result.reason).toContain('Your account has been suspended');
  });

  it('checkAccountNotSuspended allows active paid business and active trial', () => {
    const activeBiz: BusinessSubscriptionSource = {
      subscription_plan: 'essentials',
      subscription_status: 'active',
      trial_ends_at: null,
      subscription_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
    expect(checkAccountNotSuspended(activeBiz).allowed).toBe(true);
  });

  it('canCreateInvoice allows at 29 invoices, rejects at 30 for free tier', () => {
    const freeBiz: BusinessSubscriptionSource = {
      subscription_plan: 'free',
      subscription_status: 'expired',
      trial_ends_at: null,
      subscription_ends_at: null,
    };
    const allow29 = canCreateInvoice(freeBiz, 29);
    expect(allow29.allowed).toBe(true);

    const deny30 = canCreateInvoice(freeBiz, 30);
    expect(deny30.allowed).toBe(false);
    expect(deny30.code).toBe('INVOICE_QUOTA_EXCEEDED');
  });

  it('assertNotSuspended throws ActionError with code ACCOUNT_SUSPENDED for suspended business', () => {
    const suspendedBiz: BusinessSubscriptionSource = {
      subscription_plan: 'free',
      subscription_status: 'suspended',
      trial_ends_at: null,
      subscription_ends_at: null,
    };
    expect(() => assertNotSuspended(suspendedBiz)).toThrowError(ActionError);
    try {
      assertNotSuspended(suspendedBiz);
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ActionError);
      expect((e as ActionError).code).toBe('ACCOUNT_SUSPENDED');
    }
  });
});

