'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { toThrowable } from '@/lib/actions/_shared/action-error-mapping';
import { OWNER_ONLY } from '@/lib/auth/rbac';
import { writeAudit } from '@/lib/audit/log';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { db } from '@/lib/db/client';
import { setLocalLockTimeout, withTransactionRetry } from '@/lib/db/transaction';
import { businessInvitations } from '@/lib/db/schema';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { evaluateCooldown, formatRetryAfter } from '@/lib/email/send-policy';
import { teamInvitationIdSchema } from '@/lib/validations/team';
import { generateInviteToken, hashInviteToken } from '@/lib/team/invite-token';
import { computeInviteExpiry, isInviteExpired } from '@/lib/team/invite-format';
import { evaluateNewInvite } from '@/lib/team/seats';
import type { InvitableRole } from '@/lib/db/domain-values';
import { evaluateRoleGrant } from '@/lib/team/role-rules';
import { getPlanEntitlements } from '@/lib/subscriptions/entitlements';
import {
  assertBusinessNotSuspendedForTeam,
  businessDisplayName,
  lockBusinessForTeam,
  readSeatUsage,
} from '@/lib/team/team-db';
import { buildInviteUrl, sendTeamInviteEmail } from '@/lib/team/send-invite-email';

/** Minimum gap between two sends of the same invite (protects the invitee's inbox from repeated clicks). */
const TEAM_INVITE_RESEND_COOLDOWN_SECONDS = 60;

/**
 * Owner resends a pending invite (feature A): a NEW token replaces the old one (the old link stops working)
 * and the 7-day window restarts. An expired invite gives its seat back, so its seat is re-checked.
 */
export const resendTeamInvite = createAuthenticatedAction(
  teamInvitationIdSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('No business linked to your account.', { code: 'NO_BUSINESS' });
    }

    const requestContext = await getAuditRequestContext();
    const token = generateInviteToken();
    const tokenHash = hashInviteToken(token);

    let result: { email: string; role: InvitableRole; expiresAt: Date; businessName: string };
    try {
      result = await withTransactionRetry(() =>
        db.transaction(async (tx) => {
          await setLocalLockTimeout(tx);
          const now = new Date();
          const business = await lockBusinessForTeam(tx, businessId);
          assertBusinessNotSuspendedForTeam(business);

          const [invite] = await tx
            .select({
              id: businessInvitations.id,
              email: businessInvitations.email,
              role: businessInvitations.role,
              status: businessInvitations.status,
              expires_at: businessInvitations.expires_at,
              updated_at: businessInvitations.updated_at,
            })
            .from(businessInvitations)
            .where(and(eq(businessInvitations.id, input.invitation_id), eq(businessInvitations.business_id, businessId)))
            .for('update');
          if (!invite) {
            throw new ActionError('Invite not found.', { code: 'NOT_FOUND' });
          }
          if (invite.status !== 'pending') {
            throw new ActionError(
              invite.status === 'accepted' ? 'This invite has already been accepted.' : 'This invite was cancelled.',
              { code: 'INVITE_NOT_PENDING' },
            );
          }

          const grant = evaluateRoleGrant(invite.role, getPlanEntitlements(business));
          if (!grant.allowed) {
            throw new ActionError(grant.message, { code: grant.code });
          }

          const cooldown = evaluateCooldown(invite.updated_at, now, TEAM_INVITE_RESEND_COOLDOWN_SECONDS);
          if (!cooldown.allowed) {
            throw new ActionError(
              `This invite was just sent. Please wait ${formatRetryAfter(cooldown.retryAfterSeconds)} before resending.`,
              { code: 'RESEND_COOLDOWN' },
            );
          }

          if (isInviteExpired(invite.expires_at, now)) {
            const seat = evaluateNewInvite(await readSeatUsage(tx, business, now));
            if (!seat.allowed) {
              throw new ActionError(seat.message, { code: seat.code });
            }
          }

          const expiresAt = computeInviteExpiry(now);
          await tx
            .update(businessInvitations)
            .set({ token_hash: tokenHash, expires_at: expiresAt, invited_by: context.appUser.id, updated_at: now })
            .where(eq(businessInvitations.id, invite.id));

          await writeAudit(tx, {
            businessId,
            actorUserId: context.appUser.id,
            entityType: 'team',
            entityId: invite.id,
            action: 'invite_resend',
            requestContext,
            metadata: { email: invite.email, expires_at: expiresAt.toISOString() },
          });

          return { email: invite.email, role: invite.role, expiresAt, businessName: businessDisplayName(business) };
        }),
      );
    } catch (error: unknown) {
      if (error instanceof ActionError) throw error;
      throw toThrowable(error);
    }

    const inviteUrl = buildInviteUrl(token);
    const emailSent = await sendTeamInviteEmail({
      to: result.email,
      businessName: result.businessName,
      inviterName: context.appUser.display_name?.trim() || 'The business owner',
      inviteUrl,
      expiresAt: result.expiresAt,
      invitationId: input.invitation_id,
      role: result.role,
    });

    revalidatePath('/settings');

    return {
      invitationId: input.invitation_id,
      email: result.email,
      expiresAt: result.expiresAt.toISOString(),
      emailSent,
      inviteUrl,
    };
  },
  'resend-team-invite',
  {
    roles: OWNER_ONLY,
    requireActiveSubscription: true,
    rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'team-invite', outage: 'fail-closed' },
  },
);
