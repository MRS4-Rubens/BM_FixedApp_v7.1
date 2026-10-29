export type BillingCycle = 'monthly' | 'yearly';
export type PaidPlanName = 'essentials' | 'professional';

export function isBillingCycle(value: string): value is BillingCycle {
  return value === 'monthly' || value === 'yearly';
}

export function isPaidPlanName(value: string): value is PaidPlanName {
  return value === 'essentials' || value === 'professional';
}

/** Adds exactly one billing cycle in UTC, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29). Time of day is preserved. */
export function addBillingCycleUtc(base: Date, cycle: BillingCycle): Date {
  const monthsToAdd = cycle === 'yearly' ? 12 : 1;
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

