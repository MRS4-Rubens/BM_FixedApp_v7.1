import { eq } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { businesses } from '@/lib/db/schema';
import { checkAccountNotSuspended, type BusinessSubscriptionSource } from '@/lib/subscriptions/entitlements';

/** Throws ACCOUNT_SUSPENDED for a suspended business. Pure given the subscription columns. */
export function assertNotSuspended(business: BusinessSubscriptionSource): void {
  const check = checkAccountNotSuspended(business);
  if (!check.allowed) {
    throw new ActionError(check.reason ?? 'Your account has been suspended.', { code: check.code ?? 'ACCOUNT_SUSPENDED' });
  }
}

/**
 * Fast pre-check used by createAuthenticatedAction({ requireActiveSubscription: true }). One PK lookup, NOT locked:
 * a suspension that lands mid-request is tolerated here; finalize re-checks authoritatively under the business lock.
 */
export async function assertBusinessNotSuspended(businessId: string): Promise<void> {
  const [business] = await db
    .select({
      subscription_plan: businesses.subscription_plan,
      subscription_status: businesses.subscription_status,
      trial_ends_at: businesses.trial_ends_at,
      subscription_ends_at: businesses.subscription_ends_at,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (business === undefined) {
    throw new ActionError('Business not found.', { code: 'NOT_FOUND' });
  }
  assertNotSuspended(business);
}

