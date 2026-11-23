import { describe, expect, it } from 'vitest';
import {
  CLAIM_BILLING_CYCLES,
  CLAIM_PAYMENT_METHODS,
  INVOICE_TEMPLATE_IDS,
  PAID_PLAN_NAMES,
  RECORD_STATUSES,
  REQUEST_BILLING_CYCLES,
  REQUEST_PAYMENT_METHODS,
  REQUEST_STATUSES,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_STATUSES,
  isOneOf,
  type SubscriptionPlanValue,
  type SubscriptionStatusValue,
} from '@/lib/db/domain-values';
import type { PlanTier, SubscriptionStatus } from '@/lib/subscriptions/entitlements';
import {
  OVERRIDE_PLANS,
  OVERRIDE_STATUSES,
  updateBusinessSubscriptionSchema,
} from '@/lib/validations/admin-subscription';
import { subscriptionClaimSchema } from '@/lib/validations/subscription';

describe('lib/db/domain-values (DB-004 unit tests)', () => {
  const allTuples = [
    { name: 'RECORD_STATUSES', values: RECORD_STATUSES },
    { name: 'SUBSCRIPTION_PLANS', values: SUBSCRIPTION_PLANS },
    { name: 'SUBSCRIPTION_STATUSES', values: SUBSCRIPTION_STATUSES },
    { name: 'PAID_PLAN_NAMES', values: PAID_PLAN_NAMES },
    { name: 'CLAIM_BILLING_CYCLES', values: CLAIM_BILLING_CYCLES },
    { name: 'REQUEST_BILLING_CYCLES', values: REQUEST_BILLING_CYCLES },
    { name: 'CLAIM_PAYMENT_METHODS', values: CLAIM_PAYMENT_METHODS },
    { name: 'REQUEST_PAYMENT_METHODS', values: REQUEST_PAYMENT_METHODS },
    { name: 'REQUEST_STATUSES', values: REQUEST_STATUSES },
    { name: 'INVOICE_TEMPLATE_IDS', values: INVOICE_TEMPLATE_IDS },
  ];

  it('every literal in every tuple matches /^[a-z][a-z0-9_]*$/ and has no duplicates', () => {
    const pattern = /^[a-z][a-z0-9_]*$/;
    for (const { name, values } of allTuples) {
      const set = new Set<string>();
      for (const val of values) {
        expect(pattern.test(val), `"${val}" in ${name} must match ${pattern}`).toBe(true);
        expect(set.has(val), `duplicate "${val}" in ${name}`).toBe(false);
        set.add(val);
      }
    }
  });

  it('verifies subset relations: PAID_PLAN_NAMES ⊂ SUBSCRIPTION_PLANS and CLAIM_* ⊂ REQUEST_*', () => {
    // PAID_PLAN_NAMES ⊂ SUBSCRIPTION_PLANS
    const planSet = new Set<string>(SUBSCRIPTION_PLANS);
    for (const plan of PAID_PLAN_NAMES) {
      expect(planSet.has(plan)).toBe(true);
    }
    expect(PAID_PLAN_NAMES.length).toBeLessThan(SUBSCRIPTION_PLANS.length);

    // CLAIM_BILLING_CYCLES ⊂ REQUEST_BILLING_CYCLES
    const reqCycleSet = new Set<string>(REQUEST_BILLING_CYCLES);
    for (const cycle of CLAIM_BILLING_CYCLES) {
      expect(reqCycleSet.has(cycle)).toBe(true);
    }
    expect(CLAIM_BILLING_CYCLES.length).toBeLessThan(REQUEST_BILLING_CYCLES.length);

    // CLAIM_PAYMENT_METHODS ⊂ REQUEST_PAYMENT_METHODS
    const reqMethodSet = new Set<string>(REQUEST_PAYMENT_METHODS);
    for (const method of CLAIM_PAYMENT_METHODS) {
      expect(reqMethodSet.has(method)).toBe(true);
    }
    expect(CLAIM_PAYMENT_METHODS.length).toBeLessThan(REQUEST_PAYMENT_METHODS.length);
  });

  it('type and runtime parity with application entitlements types', () => {
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
      ? true
      : false;
    const planParity: Equal<PlanTier, SubscriptionPlanValue> = true;
    const statusParity: Equal<SubscriptionStatus, SubscriptionStatusValue> = true;

    expect(planParity).toBe(true);
    expect(statusParity).toBe(true);

    expect(OVERRIDE_PLANS).toEqual(SUBSCRIPTION_PLANS);
    expect(OVERRIDE_STATUSES).toEqual(SUBSCRIPTION_STATUSES);
    expect(INVOICE_TEMPLATE_IDS).toHaveLength(4);
  });

  it('isOneOf type guard accepts members and rejects invalid values', () => {
    expect(isOneOf(SUBSCRIPTION_PLANS, 'essentials')).toBe(true);
    expect(isOneOf(SUBSCRIPTION_PLANS, 'trial')).toBe(true);

    expect(isOneOf(SUBSCRIPTION_PLANS, 'enterprise')).toBe(false);
    expect(isOneOf(SUBSCRIPTION_PLANS, '')).toBe(false);
    expect(isOneOf(SUBSCRIPTION_PLANS, null)).toBe(false);
    expect(isOneOf(SUBSCRIPTION_PLANS, 42)).toBe(false);
    expect(isOneOf(SUBSCRIPTION_PLANS, 'ACTIVE')).toBe(false);
    expect(isOneOf(RECORD_STATUSES, 'ACTIVE')).toBe(false);
    expect(isOneOf(RECORD_STATUSES, 'active')).toBe(true);
  });

  it('subscriptionClaimSchema accepts valid claim values and rejects invalid values', () => {
    const validClaim = subscriptionClaimSchema.safeParse({
      plan_name: 'essentials',
      billing_cycle: 'monthly',
      payment_method: 'upi_qr',
      payment_reference: 'UTR12345678',
    });
    expect(validClaim.success).toBe(true);

    // Rejects enterprise plan
    const badPlan = subscriptionClaimSchema.safeParse({
      plan_name: 'enterprise',
      billing_cycle: 'monthly',
      payment_method: 'upi_qr',
      payment_reference: 'UTR12345678',
    });
    expect(badPlan.success).toBe(false);

    // Rejects weekly cycle
    const badCycle = subscriptionClaimSchema.safeParse({
      plan_name: 'essentials',
      billing_cycle: 'weekly',
      payment_method: 'upi_qr',
      payment_reference: 'UTR12345678',
    });
    expect(badCycle.success).toBe(false);

    // Rejects cash method
    const badMethod = subscriptionClaimSchema.safeParse({
      plan_name: 'essentials',
      billing_cycle: 'monthly',
      payment_method: 'cash',
      payment_reference: 'UTR12345678',
    });
    expect(badMethod.success).toBe(false);
  });

  it('updateBusinessSubscriptionSchema accepts free and trial override plans', () => {
    const freeOverride = updateBusinessSubscriptionSchema.safeParse({
      business_id: '11111111-1111-4111-8111-111111111111',
      subscription_plan: 'free',
      subscription_status: 'expired',
      subscription_ends_at: '',
      reason: 'Test override',
    });
    expect(freeOverride.success).toBe(true);

    const trialOverride = updateBusinessSubscriptionSchema.safeParse({
      business_id: '11111111-1111-4111-8111-111111111111',
      subscription_plan: 'trial',
      subscription_status: 'trial',
      subscription_ends_at: '',
      reason: 'Test override',
    });
    expect(trialOverride.success).toBe(true);

    const invalidOverride = updateBusinessSubscriptionSchema.safeParse({
      business_id: '11111111-1111-4111-8111-111111111111',
      subscription_plan: 'enterprise',
      subscription_status: 'active',
      subscription_ends_at: '',
      reason: 'Test override',
    });
    expect(invalidOverride.success).toBe(false);
  });
});

