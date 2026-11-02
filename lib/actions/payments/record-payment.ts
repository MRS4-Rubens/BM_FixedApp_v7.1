'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { toThrowable } from '@/lib/actions/_shared/action-error-mapping';
import { ActionError } from '@/lib/actions/_shared/errors';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { db } from '@/lib/db/client';
import { withTransactionRetry } from '@/lib/db/transaction';
import { recordPaymentInTransaction } from '@/lib/invoices/payment-tx';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { recordPaymentSchema } from '@/lib/validations/payment';
import { revalidatePath } from 'next/cache';

export const recordPayment = createAuthenticatedAction(
  recordPaymentSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Your account is not linked to a business profile.', { code: 'NO_BUSINESS_LINKED' });
    }

    try {
      const requestContext = await getAuditRequestContext();
      const result = await withTransactionRetry(() =>
        db.transaction((tx) =>
          recordPaymentInTransaction(tx, {
            businessId,
            actorUserId: context.appUser.id,
            requestContext,
            input,
          }),
        ),
      );

      revalidatePath('/invoices');
      revalidatePath(`/invoices/${input.invoice_id}`);

      return result;
    } catch (error: unknown) {
      throw toThrowable(error);
    }
  },
  'record-payment',
  { rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'record-payment' } },
);
