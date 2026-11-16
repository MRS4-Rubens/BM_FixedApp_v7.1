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
import { teamInvitationIdSchema } from '@/lib/validations/team';

/** Owner cancels a pending invite (feature A). The link stops working at once and the seat is freed. Idempotent. */
export const revokeTeamInvite = createAuthenticatedAction(
  teamInvitationIdSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('No business linked to your account.', { code: 'NO_BUSINESS' });
    }
    const requestContext = await getAuditRequestContext();

    try {
      await withTransactionRetry(() =>
        db.transaction(async (tx) => {
          await setLocalLockTimeout(tx);
          const [invite] = await tx
            .select({ id: businessInvitations.id, email: businessInvitations.email, status: businessInvitations.status })
            .from(businessInvitations)
            .where(and(eq(businessInvitations.id, input.invitation_id), eq(businessInvitations.business_id, businessId)))
            .for('update');
          if (!invite) {
            throw new ActionError('Invite not found.', { code: 'NOT_FOUND' });
          }
          if (invite.status === 'revoked') return; // already cancelled: nothing to do
          if (invite.status === 'accepted') {
            throw new ActionError('This invite has already been accepted. Remove the member instead.', {
              code: 'INVITE_NOT_PENDING',
            });
          }

          const now = new Date();
          await tx
            .update(businessInvitations)
            .set({ status: 'revoked', revoked_at: now, updated_at: now })
            .where(eq(businessInvitations.id, invite.id));

          await writeAudit(tx, {
            businessId,
            actorUserId: context.appUser.id,
            entityType: 'team',
            entityId: invite.id,
            action: 'invite_revoke',
            requestContext,
            metadata: { email: invite.email },
          });
        }),
      );
    } catch (error: unknown) {
      if (error instanceof ActionError) throw error;
      throw toThrowable(error);
    }

    revalidatePath('/settings');
    return { invitationId: input.invitation_id };
  },
  'revoke-team-invite',
  {
    roles: OWNER_ONLY,
    rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'team-manage', outage: 'fail-closed' },
  },
);
