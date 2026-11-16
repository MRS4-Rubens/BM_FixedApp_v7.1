import { and, count, eq, gt } from 'drizzle-orm';
import type { DbTransaction } from '@/lib/db/client';
import { businessInvitations, businesses, users } from '@/lib/db/schema';
import { ActionError } from '@/lib/actions/_shared/errors';
import { getPlanEntitlements } from '@/lib/subscriptions/entitlements';
import type { SeatUsage } from '@/lib/team/seats';

/**
 * Server-only team helpers (feature A). Every seat decision is taken while holding the business row lock
 * (SELECT ... FOR UPDATE), so two invites/joins for the same business can never both take the last seat.
 */
export async function lockBusinessForTeam(tx: DbTransaction, businessId: string) {
  const [business] = await tx
    .select({
      id: businesses.id,
      legal_name: businesses.legal_name,
      trade_name: businesses.trade_name,
      subscription_plan: businesses.subscription_plan,
      subscription_status: businesses.subscription_status,
      trial_ends_at: businesses.trial_ends_at,
      subscription_activated_at: businesses.subscription_activated_at,
      subscription_ends_at: businesses.subscription_ends_at,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .for('update');
  if (!business) {
    throw new ActionError('Business profile not found.', { code: 'NOT_FOUND' });
  }
  return business;
}

export type LockedTeamBusiness = Awaited<ReturnType<typeof lockBusinessForTeam>>;

export function businessDisplayName(business: Pick<LockedTeamBusiness, 'legal_name' | 'trade_name'>): string {
  return business.trade_name?.trim() || business.legal_name;
}

export async function readSeatUsage(
  tx: DbTransaction,
  business: LockedTeamBusiness,
  now: Date,
): Promise<SeatUsage> {
  const [memberRow] = await tx.select({ n: count() }).from(users).where(eq(users.business_id, business.id));
  const [inviteRow] = await tx
    .select({ n: count() })
    .from(businessInvitations)
    .where(
      and(
        eq(businessInvitations.business_id, business.id),
        eq(businessInvitations.status, 'pending'),
        gt(businessInvitations.expires_at, now),
      ),
    );
  return {
    members: memberRow?.n ?? 0,
    openInvites: inviteRow?.n ?? 0,
    limit: getPlanEntitlements(business).teamUserLimit,
  };
}

export function assertBusinessNotSuspendedForTeam(business: LockedTeamBusiness): void {
  if (getPlanEntitlements(business).isSuspended) {
    throw new ActionError('This business account is suspended. Please contact platform support.', {
      code: 'ACCOUNT_SUSPENDED',
    });
  }
}
