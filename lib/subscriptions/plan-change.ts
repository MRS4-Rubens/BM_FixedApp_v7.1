import { PLAN_PRICING } from './entitlements';
import { addBillingCycleUtc, isPaidPlanName, type BillingCycle, type PaidPlanName } from './billing-period';

/**
 * Feature G (approved decisions 2–4): what a paid claim buys, given the plan the business is on right now.
 *
 * - new:       nothing paid is running (trial, free, expired, suspended) → the paid cycle starts now.
 * - renewal:   the same paid plan is running → the cycle is added after the current expiry (unchanged behaviour).
 * - upgrade /
 *   downgrade: a DIFFERENT paid plan is running → its unused time is converted BY VALUE into time on the new plan
 *              (at the prices of the cycle being bought), the new plan starts now, and the paid cycle is added on top.
 *              No refunds, no partial payments: the claim amount stays the plan's list price.
 *
 * PURE. Exact integer maths (BigInt) for the value conversion, rounded DOWN to the millisecond, so the business
 * never receives more than the value it had.
 */
export type PlanPurchaseKind = 'new' | 'renewal' | 'upgrade' | 'downgrade';

export interface PlanPurchaseSource {
  readonly subscription_plan: string | null | undefined;
  readonly subscription_status: string | null | undefined;
  readonly subscription_ends_at: Date | string | null | undefined;
}

export interface PlanPurchase {
  readonly kind: PlanPurchaseKind;
  /** The paid plan running now (null for 'new'). */
  readonly fromPlan: PaidPlanName | null;
  /** Unused time on the running plan (0 for 'new'). For 'renewal' it is kept as-is, not converted. */
  readonly unusedMs: number;
  /** For upgrade/downgrade: the unused time converted into time on the new plan. 0 otherwise. */
  readonly creditedMs: number;
  /** Whole days, for display ("100 unused days become 66 days"). Rounded down. */
  readonly unusedDays: number;
  readonly creditedDays: number;
  /** When the purchased cycle begins (after the renewal expiry, or after the converted credit). */
  readonly cycleStartsAt: Date;
  /** The new subscription_ends_at. */
  readonly endsAt: Date;
}

const DAY_MS = 86_400_000;

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cyclePrice(plan: PaidPlanName, cycle: BillingCycle): bigint {
  const pricing = PLAN_PRICING[plan];
  return BigInt(cycle === 'yearly' ? pricing.yearlyPaise : pricing.monthlyPaise);
}

/** The paid plan that is genuinely running at `now`, or null. Mirrors getPlanEntitlements' "active paid" rule. */
function runningPaidPlan(business: PlanPurchaseSource, now: Date): { plan: PaidPlanName; endsAt: Date } | null {
  const plan = business.subscription_plan ?? '';
  if (business.subscription_status !== 'active' || !isPaidPlanName(plan)) return null;
  const endsAt = toDate(business.subscription_ends_at);
  if (endsAt === null || endsAt.getTime() <= now.getTime()) return null;
  return { plan, endsAt };
}

export function computePlanPurchase(
  business: PlanPurchaseSource,
  plan: PaidPlanName,
  cycle: BillingCycle,
  now: Date,
): PlanPurchase {
  const running = runningPaidPlan(business, now);

  if (running === null) {
    const cycleStartsAt = new Date(now.getTime());
    return {
      kind: 'new',
      fromPlan: null,
      unusedMs: 0,
      creditedMs: 0,
      unusedDays: 0,
      creditedDays: 0,
      cycleStartsAt,
      endsAt: addBillingCycleUtc(cycleStartsAt, cycle),
    };
  }

  const unusedMs = running.endsAt.getTime() - now.getTime();

  if (running.plan === plan) {
    const cycleStartsAt = new Date(running.endsAt.getTime());
    return {
      kind: 'renewal',
      fromPlan: running.plan,
      unusedMs,
      creditedMs: 0,
      unusedDays: Math.floor(unusedMs / DAY_MS),
      creditedDays: 0,
      cycleStartsAt,
      endsAt: addBillingCycleUtc(cycleStartsAt, cycle),
    };
  }

  const oldPrice = cyclePrice(running.plan, cycle);
  const newPrice = cyclePrice(plan, cycle);
  const creditedMs = Number((BigInt(unusedMs) * oldPrice) / newPrice); // BigInt division rounds down
  const cycleStartsAt = new Date(now.getTime() + creditedMs);
  return {
    kind: newPrice > oldPrice ? 'upgrade' : 'downgrade',
    fromPlan: running.plan,
    unusedMs,
    creditedMs,
    unusedDays: Math.floor(unusedMs / DAY_MS),
    creditedDays: Math.floor(creditedMs / DAY_MS),
    cycleStartsAt,
    endsAt: addBillingCycleUtc(cycleStartsAt, cycle),
  };
}
