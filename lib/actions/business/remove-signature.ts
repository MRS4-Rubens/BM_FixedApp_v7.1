'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { OWNER_ONLY } from '@/lib/auth/rbac';
import { ActionError } from '@/lib/actions/_shared/errors';
import { toThrowable } from '@/lib/actions/_shared/action-error-mapping';
import { writeAudit } from '@/lib/audit/log';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { db } from '@/lib/db/client';
import { setLocalLockTimeout, withTransactionRetry } from '@/lib/db/transaction';
import { businesses } from '@/lib/db/schema';
import { deleteSignatureObjectIfUnreferenced } from '@/lib/storage/signature';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

export const removeBusinessSignature = createAuthenticatedAction(
  z.object({}),
  async (_input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('No business linked to your account.', { code: 'NO_BUSINESS' });
    }

    const requestContext = await getAuditRequestContext();

    let previousKey: string | null = null;
    try {
      previousKey = await withTransactionRetry(() =>
        db.transaction(async (tx) => {
          await setLocalLockTimeout(tx);
          const [row] = await tx
            .select({ key: businesses.signature_storage_key })
            .from(businesses)
            .where(eq(businesses.id, businessId))
            .for('update');
          if (!row) throw new ActionError('Business profile not found.', { code: 'NOT_FOUND' });

          if (row.key === null) {
            return null;
          }

          await tx
            .update(businesses)
            .set({
              signature_storage_key: null,
              updated_at: new Date(),
            })
            .where(eq(businesses.id, businessId));

          await writeAudit(tx, {
            businessId,
            actorUserId: context.appUser.id,
            entityType: 'business',
            entityId: businessId,
            action: 'signature_remove',
            requestContext,
            metadata: {
              previous_signature_storage_key: row.key,
            },
          });

          return row.key;
        }),
      );
    } catch (dbError: unknown) {
      if (dbError instanceof ActionError) throw dbError;
      throw toThrowable(dbError);
    }

    if (previousKey !== null) {
      await deleteSignatureObjectIfUnreferenced(businessId, previousKey);
    }

    revalidatePath('/settings');
    revalidatePath('/invoices');
    revalidatePath('/credit-notes');

    return { hasSignature: false };
  },
  'remove-business-signature',
  {
    roles: OWNER_ONLY,
    rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'remove-signature', outage: 'fail-closed' },
    requireActiveSubscription: true,
  },
);

