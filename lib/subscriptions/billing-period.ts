import { CLAIM_BILLING_CYCLES, PAID_PLAN_NAMES, isOneOf } from '@/lib/db/domain-values';

export type BillingCycle = (typeof CLAIM_BILLING_CYCLES)[number];
export type PaidPlanName = (typeof PAID_PLAN_NAMES)[number];

export function isBillingCycle(value: string): value is BillingCycle {
  return isOneOf(CLAIM_BILLING_CYCLES, value);
}

export function isPaidPlanName(value: string): value is PaidPlanName {
  return isOneOf(PAID_PLAN_NAMES, value);
}

/** Adds exactly one billing cycle in UTC, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29). Time of day is preserved. */
export function addBillingCycleUtc(base: Date, cycle: BillingCycle): Date {
  return addMonthsClampedUtc(base, cycle === 'yearly' ? 12 : 1);
}

/**
 * Adds whole months in UTC, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29). Time of day
 * is preserved. BUG-03: the checkout and admin previews use this too, so they show the date the server stores
 * (Date#setMonth rolls Jan 31 + 1 month over to 3 Mar).
 */
export function addMonthsClampedUtc(base: Date, monthsToAdd: number): Date {
  const targetIndex = base.getUTCMonth() + monthsToAdd;
  const targetYear = base.getUTCFullYear() + Math.floor(targetIndex / 12);
  const targetMonth = targetIndex % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(base.getUTCDate(), lastDayOfTargetMonth),
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds(),
    ),
  );
}

/** Early renewals extend from the current expiry (if still in the future); otherwise from `now`. */
export function resolveApprovalBase(currentExpiry: Date | string | null, now: Date): Date {
  if (currentExpiry === null) return new Date(now.getTime());
  const expiry = currentExpiry instanceof Date ? currentExpiry : new Date(currentExpiry);
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= now.getTime()) return new Date(now.getTime());
  return new Date(expiry.getTime());
}
