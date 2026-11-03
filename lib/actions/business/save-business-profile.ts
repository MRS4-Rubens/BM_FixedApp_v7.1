'use server';

import { revalidatePath } from 'next/cache';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { OWNER_ONLY } from '@/lib/auth/rbac';
import {
  saveBusinessProfileInTransaction,
  type SaveProfileTxResult,
  DEFAULT_INVOICE_NUMBER_FORMAT,
  DEFAULT_CREDIT_NOTE_PREFIX,
  DEFAULT_PAYMENT_DUE_DAYS,
  TRIAL_DURATION_DAYS,
  DEFAULT_INVOICE_TERMS,
} from '@/lib/business/save-profile-tx';
import {
  isGstinUniqueViolation,
  buildGstinTakenMessage,
} from '@/lib/business/identity-policy';
import { db } from '@/lib/db/client';
import { toBusyActionError, withTransactionRetry } from '@/lib/db/transaction';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { businessProfileSchema } from '@/lib/validations/business';

export {
  DEFAULT_INVOICE_NUMBER_FORMAT,
  DEFAULT_CREDIT_NOTE_PREFIX,
  DEFAULT_PAYMENT_DUE_DAYS,
  TRIAL_DURATION_DAYS,
  DEFAULT_INVOICE_TERMS,
};

export const saveBusinessProfile = createAuthenticatedAction(
  businessProfileSchema,
  async (input, context): Promise<{ businessId: string }> => {
    const requestContext = await getAuditRequestContext();
    let result: SaveProfileTxResult;

    try {
      result = await withTransactionRetry(() =>
        db.transaction((tx) =>
          saveBusinessProfileInTransaction(tx, {
            userId: context.appUser.id,
            profile: input,
            requestContext,
          }),
        ),
      );
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
      throw error;
    }

    revalidatePath('/settings');
    revalidatePath('/invoices/new');
    revalidatePath('/invoices');

    return { businessId: result.businessId };
  },
  'save-business-profile',
  {
    roles: OWNER_ONLY,
    requireActiveSubscription: true,
    rateLimit: {
      limiter: sensitiveActionLimiter,
      keyPrefix: 'save-business-profile',
    },
  },
);
