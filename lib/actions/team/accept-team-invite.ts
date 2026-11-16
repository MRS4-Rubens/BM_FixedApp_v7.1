'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { toThrowable } from '@/lib/actions/_shared/action-error-mapping';
import { writeAudit } from '@/lib/audit/log';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { getRequestSession } from '@/lib/auth/request-session';
import { db } from '@/lib/db/client';
import { setLocalLockTimeout, withTransactionRetry } from '@/lib/db/transaction';
import { businessInvitations, users } from '@/lib/db/schema';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { acceptTeamInviteSchema } from '@/lib/validations/team';
import { hashInviteToken } from '@/lib/team/invite-token';
import { evaluateAccept } from '@/lib/team/accept-rules';
import { evaluateJoin } from '@/lib/team/seats';
import { evaluateRoleGrant } from '@/lib/team/role-rules';
import { getPlanEntitlements } from '@/lib/subscriptions/entitlements';
import { assertBusinessNotSuspendedForTeam, lockBusinessForTeam, readSeatUsage } from '@/lib/team/team-db';
import { clearPendingInviteCookie } from '@/lib/team/pending-invite-cookie';

/**
 * A signed-in person accepts a team invite (feature A). Runs for accounts WITHOUT a business, so it is
 * classified 'signed-in' (no roles option). Every rule is re-checked inside one transaction that locks the
 * invite row and then the business row (seat check), and the user row is only linked if it is still
 * business-less (`business_id IS NULL`), so double clicks, two tabs or a parallel invite can never link an
 * account twice or overfill a plan.
 */
export const acceptTeamInvite = createAuthenticatedAction(
  acceptTeamInviteSchema,
  async (input, context) => {
    const session = (await getRequestSession())?.data;
    const sessionEmail = session?.user?.email ?? null;
    const emailVerified = session?.user?.emailVerified === true;
    const requestContext = await getAuditRequestContext();
    const tokenHash = hashInviteToken(input.token);

    let joined: { businessId: string };
    try {
      joined = await withTransactionRetry(() =>
        db.transaction(async (tx) => {
          await setLocalLockTimeout(tx);
          const now = new Date();

          // Lock order everywhere in the team actions: business -> invitation -> user (no deadlocks).
          const [target] = await tx
            .select({ business_id: businessInvitations.business_id })
            .from(businessInvitations)
            .where(eq(businessInvitations.token_hash, tokenHash))
            .limit(1);
          if (!target) {
            throw new ActionError('This invite link is not valid. It may have been replaced by a newer invite.', {
              code: 'INVITE_NOT_FOUND',
            });
          }
          const business = await lockBusinessForTeam(tx, target.business_id);

          const [invite] = await tx
            .select({
              id: businessInvitations.id,
              business_id: businessInvitations.business_id,
              email: businessInvitations.email,
              role: businessInvitations.role,
              status: businessInvitations.status,
              expires_at: businessInvitations.expires_at,
              accepted_by: businessInvitations.accepted_by,
            })
            .from(businessInvitations)
            .where(
              and(eq(businessInvitations.token_hash, tokenHash), eq(businessInvitations.business_id, business.id)),
            )
            .for('update');
          if (!invite) {
            throw new ActionError('This invite link is not valid. It may have been replaced by a newer invite.', {
              code: 'INVITE_NOT_FOUND',
            });
          }

          const [freshUser] = await tx
            .select({ id: users.id, business_id: users.business_id })
            .from(users)
            .where(eq(users.id, context.appUser.id))
            .for('update');
          if (!freshUser) {
            throw new ActionError('Your account could not be found. Please sign in again.', { code: 'NO_APP_USER' });
          }

          const decision = evaluateAccept(
            {
              status: invite.status,
              email: invite.email,
              expiresAt: invite.expires_at,
              businessId: invite.business_id,
              acceptedBy: invite.accepted_by,
            },
            { appUserId: freshUser.id, businessId: freshUser.business_id, sessionEmail, emailVerified },
            now,
          );
          if (!decision.ok) {
            throw new ActionError(decision.message, { code: decision.code });
          }

          assertBusinessNotSuspendedForTeam(business);
          const usage = await readSeatUsage(tx, business, now);
          // An accountant invite needs Professional at JOIN time too (decision 6: no new CA after a downgrade).
          const grant = evaluateRoleGrant(invite.role, getPlanEntitlements(business));
          if (!grant.allowed) {
            throw new ActionError(grant.message, { code: grant.code });
          }
          const seat = evaluateJoin(usage);
          if (!seat.allowed) {
            throw new ActionError(seat.message, { code: seat.code });
          }

          const [linked] = await tx
            .update(users)
            .set({ business_id: invite.business_id, role: invite.role, updated_at: now })
            .where(and(eq(users.id, freshUser.id), isNull(users.business_id)))
            .returning({ id: users.id });
          if (!linked) {
            throw new ActionError('This account already belongs to a business.', { code: 'ALREADY_IN_BUSINESS' });
          }

          await tx
            .update(businessInvitations)
            .set({ status: 'accepted', accepted_by: freshUser.id, accepted_at: now, updated_at: now })
            .where(and(eq(businessInvitations.id, invite.id), eq(businessInvitations.status, 'pending')));

          await writeAudit(tx, {
            businessId: invite.business_id,
            actorUserId: freshUser.id,
            entityType: 'team',
            entityId: freshUser.id,
            action: 'member_join',
            requestContext,
            metadata: { invitation_id: invite.id, email: invite.email, role: invite.role },
          });

          return { businessId: invite.business_id };
        }),
      );
    } catch (error: unknown) {
      if (error instanceof ActionError) throw error;
      throw toThrowable(error);
    }

    await clearPendingInviteCookie();
    revalidatePath('/', 'layout');
    return { businessId: joined.businessId };
  },
  'accept-team-invite',
  {
    rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'team-accept', outage: 'fail-closed' },
  },
);
