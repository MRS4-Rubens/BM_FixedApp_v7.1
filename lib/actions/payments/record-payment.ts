'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { EDITOR_ROLES } from '@/lib/auth/rbac';
import { toThrowable } from '@/lib/actions/_shared/action-error-mapping';
import { ActionError } from '@/lib/actions/_shared/errors';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { db } from '@/lib/db/client';
import { withTransactionRetry } from '@/lib/db/transaction';
import { recordPaymentInTransaction } from '@/lib/invoices/payment-tx';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { recordPaymentSchema } from '@/lib/validations/payment';
import { revalidateAfterCommit } from '@/lib/actions/_shared/revalidate-after-commit';

export const recordPayment = createAuthenticatedAction(
  recordPaymentSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Your account is not linked to a business profile.', { code: 'NO_BUSINESS_LINKED' });
    }

    let result: Awaited<ReturnType<typeof recordPaymentInTransaction>>;
    try {
      const requestContext = await getAuditRequestContext();
      result = await withTransactionRetry(() =>
        db.transaction((tx) =>
          recordPaymentInTransaction(tx, {
            businessId,
            actorUserId: context.appUser.id,
            requestContext,
            input,
          }),
        ),
      );
    } catch (error: unknown) {
      throw toThrowable(error);
    }

    // BUG-05: the payment is committed. Nothing after this point may report a failure (a retry would record it twice).
    revalidateAfterCommit('record-payment', ['/invoices', `/invoices/${input.invoice_id}`]);
    return result;
  },
  'record-payment',
  {
    roles: EDITOR_ROLES,
    rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'record-payment', outage: 'fail-open' },
    requireActiveSubscription: true,
  },
);
