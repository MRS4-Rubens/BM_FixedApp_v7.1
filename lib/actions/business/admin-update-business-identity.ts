'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { writeAudit } from '@/lib/audit/log';
import {
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
              legal_name: businesses.legal_name,
              pan: businesses.pan,
            })
            .from(businesses)
            .where(eq(businesses.id, input.business_id))
            .for('update');

          if (!business) {
            throw new ActionError('Business not found.', { code: 'NOT_FOUND' });
          }

          const { gstin, legal_name: legalName } = input;
          if ((gstin && gstin.previous !== business.gstin) ||
              (legalName && legalName.previous !== business.legal_name)) {
            throw new ActionError(
              'A selected field changed since you opened this dialog. Reload the business and try again.',
              { code: 'STALE_IDENTITY' },
            );
          }

          const stateCode = gstin?.value.slice(0, 2);
          const pan = gstin?.value.slice(2, 12);
          const updates = {
            ...(gstin && gstin.value !== business.gstin ? { gstin: gstin.value } : {}),
            ...(stateCode && stateCode !== business.state_code ? { state_code: stateCode } : {}),
            ...(pan && pan !== business.pan ? { pan } : {}),
            ...(legalName && legalName.value !== business.legal_name.trim() ? { legal_name: legalName.value } : {}),
          };
          const fields = Object.keys(updates) as (keyof typeof updates)[];
          if (fields.length === 0) {
            throw new ActionError(
              'The selected fields already have these values.',
              { code: 'NO_CHANGE' },
            );
          }

          const hadFinalizedInvoices = await hasFinalizedInvoices(tx, input.business_id);

          await tx
            .update(businesses)
            .set({
              ...updates,
              updated_at: new Date(),
            })
            .where(eq(businesses.id, input.business_id));

          const auditValueFields = fields.filter((field) => field !== 'pan');
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
              fields,
              previous: Object.fromEntries(auditValueFields.map((field) => [field, business[field]])),
              next: Object.fromEntries(auditValueFields.map((field) => [field, updates[field]])),
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

