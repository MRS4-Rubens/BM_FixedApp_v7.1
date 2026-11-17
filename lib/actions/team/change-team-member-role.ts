'use server';

import { randomUUID } from 'node:crypto';
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
import { getPlanEntitlements } from '@/lib/subscriptions/entitlements';
import { changeTeamMemberRoleSchema } from '@/lib/validations/team';
import { evaluateRoleGrant } from '@/lib/team/role-rules';
import { roleChangedDraft } from '@/lib/notifications/messages';
import { notifyInTransaction } from '@/lib/notifications/notify';
import { assertBusinessNotSuspendedForTeam, lockBusinessForTeam } from '@/lib/team/team-db';

/**
 * Feature B: the owner switches a member between 'staff' (team member) and 'accountant' (read-only CA).
 * The owner role is never granted or taken here (no ownership transfer). Making someone an accountant needs
 * Professional; switching an accountant back to staff is always allowed. Takes effect on the member's next
 * request (every request re-reads the users row). Idempotent: the same role is a no-op.
 */
export const changeTeamMemberRole = createAuthenticatedAction(
  changeTeamMemberRoleSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('No business linked to your account.', { code: 'NO_BUSINESS' });
    }
    if (input.user_id === context.appUser.id) {
      throw new ActionError('You cannot change your own role. The owner account always stays the owner.', {
        code: 'CANNOT_CHANGE_OWN_ROLE',
      });
    }
    const requestContext = await getAuditRequestContext();

    let changed = false;
    try {
      changed = await withTransactionRetry(() =>
        db.transaction(async (tx) => {
          await setLocalLockTimeout(tx);
          const business = await lockBusinessForTeam(tx, businessId); // lock order: business -> user
          assertBusinessNotSuspendedForTeam(business);

          const [member] = await tx
            .select({ id: users.id, email: users.email, role: users.role })
            .from(users)
            .where(and(eq(users.id, input.user_id), eq(users.business_id, businessId)))
            .for('update');
          if (!member) {
            throw new ActionError('This person is not a member of your business.', { code: 'NOT_FOUND' });
          }
          if (member.role === 'owner') {
            throw new ActionError("The owner's role cannot be changed.", { code: 'CANNOT_CHANGE_OWNER' });
          }
          if (member.role === input.role) {
            return false;
          }

          const grant = evaluateRoleGrant(input.role, getPlanEntitlements(business));
          if (!grant.allowed) {
            throw new ActionError(grant.message, { code: grant.code });
          }

          await tx
            .update(users)
            .set({ role: input.role, updated_at: new Date() })
            .where(and(eq(users.id, member.id), eq(users.business_id, businessId)));

          await writeAudit(tx, {
            businessId,
            actorUserId: context.appUser.id,
            entityType: 'team',
            entityId: member.id,
            action: 'member_role_change',
            requestContext,
            metadata: { email: member.email, previous_role: member.role, new_role: input.role },
          });
          // Feature C: tell the member their role changed (savepoint: never blocks the change itself).
          await notifyInTransaction(tx, {
            businessId,
            draft: roleChangedDraft(randomUUID(), input.role),
            recipientUserIds: [member.id],
          });
          return true;
        }),
      );
    } catch (error: unknown) {
      if (error instanceof ActionError) throw error;
      throw toThrowable(error);
    }

    revalidatePath('/settings');
    return { userId: input.user_id, role: input.role, changed };
  },
  'change-team-member-role',
  {
    roles: OWNER_ONLY,
    rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'team-manage', outage: 'fail-closed' },
  },
);
