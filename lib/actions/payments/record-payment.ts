'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { db } from '@/lib/db/client';
import { toBusyActionError, withTransactionRetry } from '@/lib/db/transaction';
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
      const result = await withTransactionRetry(() =>
        db.transaction((tx) => recordPaymentInTransaction(tx, { businessId, input })),
      );

      revalidatePath('/invoices');
      revalidatePath(`/invoices/${input.invoice_id}`);

      return result;
    } catch (error: unknown) {
      if (error instanceof ActionError) throw error;
      const busy = toBusyActionError(error);
      if (busy) throw busy;
      logError('record-payment', error, { invoiceId: input.invoice_id });
      throw new ActionError('We could not record the payment. Please try again.', { code: 'TRANSACTION_FAILED' });
    }
  },
  'record-payment',
  { rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'record-payment' } },
);
