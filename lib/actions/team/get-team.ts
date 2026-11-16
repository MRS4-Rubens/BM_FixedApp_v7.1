'use server';

import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { OWNER_ONLY } from '@/lib/auth/rbac';
import { db } from '@/lib/db/client';
import { businessInvitations, businesses, users } from '@/lib/db/schema';
import { getPlanEntitlements } from '@/lib/subscriptions/entitlements';
import { isInviteExpired } from '@/lib/team/invite-format';
import { evaluateNewInvite, seatsUsed } from '@/lib/team/seats';

/**
 * Owner's view of the team (feature A): members, open/expired invites and seat usage.
 * Accepted and cancelled invites are history and are not listed (the audit log keeps them).
 * Token hashes are never returned.
 */
export const getTeam = createAuthenticatedAction(
  z.object({}),
  async (_input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('No business linked to your account.', { code: 'NO_BUSINESS' });
    }

    const [business] = await db
      .select({
        subscription_plan: businesses.subscription_plan,
        subscription_status: businesses.subscription_status,
        trial_ends_at: businesses.trial_ends_at,
        subscription_activated_at: businesses.subscription_activated_at,
        subscription_ends_at: businesses.subscription_ends_at,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    if (!business) {
      throw new ActionError('Business profile not found.', { code: 'NOT_FOUND' });
    }

    const [memberRows, inviteRows] = await Promise.all([
      db
        .select({
          id: users.id,
          name: users.display_name,
          email: users.email,
          role: users.role,
          createdAt: users.created_at,
        })
        .from(users)
        .where(eq(users.business_id, businessId))
        .orderBy(asc(users.created_at)),
      db
        .select({
          id: businessInvitations.id,
          email: businessInvitations.email,
          role: businessInvitations.role,
          expiresAt: businessInvitations.expires_at,
          sentAt: businessInvitations.updated_at,
        })
        .from(businessInvitations)
        .where(and(eq(businessInvitations.business_id, businessId), eq(businessInvitations.status, 'pending')))
        .orderBy(desc(businessInvitations.updated_at)),
    ]);

    const now = new Date();
    const invites = inviteRows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      expiresAt: row.expiresAt.toISOString(),
      sentAt: row.sentAt.toISOString(),
      isExpired: isInviteExpired(row.expiresAt, now),
    }));
    const usage = {
      members: memberRows.length,
      openInvites: invites.filter((invite) => !invite.isExpired).length,
      limit: getPlanEntitlements(business).teamUserLimit,
    };
    const canInvite = evaluateNewInvite(usage);

    return {
      members: memberRows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        isYou: row.id === context.appUser.id,
        createdAt: row.createdAt.toISOString(),
      })),
      invites,
      seats: {
        used: seatsUsed(usage),
        limit: usage.limit,
        members: usage.members,
        openInvites: usage.openInvites,
        // Over the limit after a downgrade/expiry: nobody is removed, but no new invites (decision 6).
        overLimit: usage.limit !== null && usage.members > usage.limit,
      },
      canInvite: canInvite.allowed,
      cannotInviteReason: canInvite.allowed ? null : canInvite.message,
      // Lets the UI offer "Upgrade plan" only when upgrading actually helps (not for a full Essentials team).
      cannotInviteCode: canInvite.allowed ? null : canInvite.code,
    };
  },
  'get-team',
  { roles: OWNER_ONLY },
);
