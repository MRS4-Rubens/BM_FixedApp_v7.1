'use server';

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { toThrowable, type PgConstraintMapping } from '@/lib/actions/_shared/action-error-mapping';
import { OWNER_ONLY } from '@/lib/auth/rbac';
import { writeAudit } from '@/lib/audit/log';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { db } from '@/lib/db/client';
import { setLocalLockTimeout, withTransactionRetry } from '@/lib/db/transaction';
import { businessInvitations, users } from '@/lib/db/schema';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { inviteTeamMemberSchema } from '@/lib/validations/team';
import { generateInviteToken, hashInviteToken } from '@/lib/team/invite-token';
import { computeInviteExpiry, isInviteExpired } from '@/lib/team/invite-format';
import { evaluateNewInvite } from '@/lib/team/seats';
import {
  assertBusinessNotSuspendedForTeam,
  businessDisplayName,
  lockBusinessForTeam,
  readSeatUsage,
} from '@/lib/team/team-db';
import { buildInviteUrl, sendTeamInviteEmail } from '@/lib/team/send-invite-email';

const INVITE_CONSTRAINTS: readonly PgConstraintMapping[] = [
  {
    sqlState: '23505',
    constraint: 'business_invitations_one_pending_per_email',
    code: 'ALREADY_INVITED',
    message: 'This person already has a pending invite. Use Resend instead.',
    field: 'email',
  },
];

/**
 * Owner invites someone by e-mail (feature A).
 * Seats are checked under the business row lock. An EXPIRED pending invite for the same e-mail is reused
 * (new token + new expiry) instead of creating a second row. Whether the address already has an account
 * elsewhere is deliberately NOT checked here (that would let owners probe who uses the platform); the accept
 * step enforces "one account = one business".
 */
export const inviteTeamMember = createAuthenticatedAction(
  inviteTeamMemberSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Set up your business profile before inviting team members.', { code: 'NO_BUSINESS' });
    }
    if (context.appUser.email && context.appUser.email.trim().toLowerCase() === input.email) {
      throw new ActionError('You are already the owner of this business.', {
        code: 'CANNOT_INVITE_SELF',
        fieldErrors: { email: ['You are already the owner of this business.'] },
      });
    }

    const requestContext = await getAuditRequestContext();
    const token = generateInviteToken();
    const tokenHash = hashInviteToken(token);

    let result: { invitationId: string; expiresAt: Date; businessName: string; reused: boolean };
    try {
      result = await withTransactionRetry(() =>
        db.transaction(async (tx) => {
          await setLocalLockTimeout(tx);
          const now = new Date();
          const business = await lockBusinessForTeam(tx, businessId);
          assertBusinessNotSuspendedForTeam(business);

          const [existingMember] = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.business_id, businessId), sql`lower(${users.email}) = ${input.email}`))
            .limit(1);
          if (existingMember) {
            throw new ActionError('This person is already a member of your business.', {
              code: 'ALREADY_MEMBER',
              fieldErrors: { email: ['This person is already a member of your business.'] },
            });
          }

          const [openRow] = await tx
            .select({ id: businessInvitations.id, expires_at: businessInvitations.expires_at })
            .from(businessInvitations)
            .where(
              and(
                eq(businessInvitations.business_id, businessId),
                eq(businessInvitations.email, input.email),
                eq(businessInvitations.status, 'pending'),
              ),
            )
            .limit(1);
          if (openRow && !isInviteExpired(openRow.expires_at, now)) {
            throw new ActionError('This person already has a pending invite. Use Resend instead.', {
              code: 'ALREADY_INVITED',
              fieldErrors: { email: ['This person already has a pending invite. Use Resend instead.'] },
            });
          }

          // An expired pending row does not hold a seat (readSeatUsage counts unexpired invites only).
          const seat = evaluateNewInvite(await readSeatUsage(tx, business, now));
          if (!seat.allowed) {
            throw new ActionError(seat.message, { code: seat.code });
          }

          const expiresAt = computeInviteExpiry(now);
          let invitationId: string;
          if (openRow) {
            await tx
              .update(businessInvitations)
              .set({
                token_hash: tokenHash,
                role: input.role,
                invited_by: context.appUser.id,
                expires_at: expiresAt,
                updated_at: now,
              })
              .where(eq(businessInvitations.id, openRow.id));
            invitationId = openRow.id;
          } else {
            const [inserted] = await tx
              .insert(businessInvitations)
              .values({
                business_id: businessId,
                email: input.email,
                role: input.role,
                token_hash: tokenHash,
                status: 'pending',
                invited_by: context.appUser.id,
                expires_at: expiresAt,
              })
              .returning({ id: businessInvitations.id });
            if (!inserted) {
              throw new ActionError('We could not create the invite. Please try again.', { code: 'TRANSACTION_FAILED' });
            }
            invitationId = inserted.id;
          }

          await writeAudit(tx, {
            businessId,
            actorUserId: context.appUser.id,
            entityType: 'team',
            entityId: invitationId,
            action: 'invite_create',
            requestContext,
            metadata: { email: input.email, role: input.role, expires_at: expiresAt.toISOString(), reused_expired: Boolean(openRow) },
          });

          return { invitationId, expiresAt, businessName: businessDisplayName(business), reused: Boolean(openRow) };
        }),
      );
    } catch (error: unknown) {
      if (error instanceof ActionError) throw error;
      throw toThrowable(error, INVITE_CONSTRAINTS);
    }

    const inviteUrl = buildInviteUrl(token);
    const emailSent = await sendTeamInviteEmail({
      to: input.email,
      businessName: result.businessName,
      inviterName: context.appUser.display_name?.trim() || 'The business owner',
      inviteUrl,
      expiresAt: result.expiresAt,
      invitationId: result.invitationId,
    });

    revalidatePath('/settings');

    return {
      invitationId: result.invitationId,
      email: input.email,
      expiresAt: result.expiresAt.toISOString(),
      emailSent,
      // Returned to the OWNER only (owner-only action) so they can also share it, e.g. on WhatsApp.
      inviteUrl,
    };
  },
  'invite-team-member',
  {
    roles: OWNER_ONLY,
    requireActiveSubscription: true,
    rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'team-invite', outage: 'fail-closed' },
  },
);
