'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { writeAudit } from '@/lib/audit/log';
import {
  diffBusinessIdentity,
  isGstinUniqueViolation,
  buildGstinTakenMessage,
} from '@/lib/business/identity-policy';
import { hasFinalizedInvoices } from '@/lib/business/identity-lock';
import { db } from '@/lib/db/client';
import { businesses } from '@/lib/db/schema';
import { setLocalLockTimeout, toBusyActionError, withTransactionRetry } from '@/lib/db/transaction';
import { adminUpdateBusinessIdentitySchema } from '@/lib/validations/admin-business-identity';

export const adminUpdateBusinessIdentity = createAuthenticatedAction(
  adminUpdateBusinessIdentitySchema,
  async (input, context): Promise<{ businessId: string }> => {
    const requestContext = await getAuditRequestContext();

    try {
      await withTransactionRetry(async () => {
        await db.transaction(async (tx) => {
          await setLocalLockTimeout(tx);

          const [business] = await tx
            .select({
              id: businesses.id,
              gstin: businesses.gstin,
              state_code: businesses.state_code,
            })
            .from(businesses)
            .where(eq(businesses.id, input.business_id))
            .for('update');

          if (!business) {
            throw new ActionError('Business not found.', { code: 'NOT_FOUND' });
          }

          const change = diffBusinessIdentity(business, {
            gstin: input.gstin,
            state_code: input.state_code,
          });

          if (change.kind === 'unchanged') {
            throw new ActionError(
              'Nothing to change: the GSTIN and state already have these values.',
              { code: 'NO_CHANGE' },
            );
          }

          const hadFinalizedInvoices = await hasFinalizedInvoices(tx, input.business_id);

          await tx
            .update(businesses)
            .set({
              gstin: input.gstin,
              state_code: input.state_code,
              updated_at: new Date(),
            })
            .where(eq(businesses.id, input.business_id));

          await writeAudit(tx, {
            businessId: input.business_id,
            actorUserId: context.appUser.id,
            entityType: 'business',
            entityId: input.business_id,
            action: 'business_identity_changed_by_admin',
            requestContext,
            metadata: {
              source: 'platform_admin',
              reason: input.reason,
              previous: { gstin: business.gstin, state_code: business.state_code },
              next: { gstin: input.gstin, state_code: input.state_code },
              had_finalized_invoices: hadFinalizedInvoices,
            },
          });
        });
      });
    } catch (error: unknown) {
      if (error instanceof ActionError) throw error;
      if (isGstinUniqueViolation(error)) {
        throw new ActionError(buildGstinTakenMessage(), {
          code: 'GSTIN_ALREADY_REGISTERED',
          fieldErrors: { gstin: [buildGstinTakenMessage()] },
        });
      }
      const busy = toBusyActionError(error);
      if (busy) throw busy;
      logError('admin-update-business-identity', error);
      throw new ActionError('We could not update the business identity. Please try again.', {
        code: 'TRANSACTION_FAILED',
      });
    }

    revalidatePath('/settings');
    return { businessId: input.business_id };
  },
  'admin-update-business-identity',
  { requirePlatformAdmin: true },
);

