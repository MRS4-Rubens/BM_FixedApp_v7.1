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
import { users } from '@/lib/db/schema';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { removeTeamMemberSchema } from '@/lib/validations/team';
import { lockBusinessForTeam } from '@/lib/team/team-db';

/**
 * Owner removes a STAFF member (feature A). The account is unlinked, never deleted: business_id -> null and the
 * role goes back to 'owner' (the default for an account without a business), so the person can later create
 * their own business. Everything they created stays, and the audit log still names them. Access ends on their
 * next request, because every request re-reads the users row.
 */
export const removeTeamMember = createAuthenticatedAction(
  removeTeamMemberSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('No business linked to your account.', { code: 'NO_BUSINESS' });
    }
    if (input.user_id === context.appUser.id) {
      throw new ActionError('You cannot remove yourself. The owner account always stays with the business.', {
        code: 'CANNOT_REMOVE_SELF',
      });
    }
    const requestContext = await getAuditRequestContext();

    try {
      await withTransactionRetry(() =>
        db.transaction(async (tx) => {
          await setLocalLockTimeout(tx);
          await lockBusinessForTeam(tx, businessId); // serialises with invites/joins for this business

          const [member] = await tx
            .select({ id: users.id, email: users.email, role: users.role })
            .from(users)
            .where(and(eq(users.id, input.user_id), eq(users.business_id, businessId)))
            .for('update');
          if (!member) {
            throw new ActionError('This person is not a member of your business.', { code: 'NOT_FOUND' });
          }
          if (member.role !== 'staff') {
            throw new ActionError('Only team members can be removed. The owner account always stays with the business.', {
              code: 'CANNOT_REMOVE_OWNER',
            });
          }

          const now = new Date();
          await tx
            .update(users)
            .set({ business_id: null, role: 'owner', updated_at: now })
            .where(and(eq(users.id, member.id), eq(users.business_id, businessId)));

          await writeAudit(tx, {
            businessId,
            actorUserId: context.appUser.id,
            entityType: 'team',
            entityId: member.id,
            action: 'member_remove',
            requestContext,
            metadata: { email: member.email, previous_role: member.role },
          });
        }),
      );
    } catch (error: unknown) {
      if (error instanceof ActionError) throw error;
      throw toThrowable(error);
    }

    revalidatePath('/settings');
    return { userId: input.user_id };
  },
  'remove-team-member',
  {
    roles: OWNER_ONLY,
    rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'team-manage', outage: 'fail-closed' },
  },
);
