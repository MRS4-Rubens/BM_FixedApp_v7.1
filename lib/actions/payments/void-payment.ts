'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { toThrowable } from '@/lib/actions/_shared/action-error-mapping';
import { ActionError } from '@/lib/actions/_shared/errors';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { db } from '@/lib/db/client';
import { withTransactionRetry } from '@/lib/db/transaction';
import { voidPaymentInTransaction } from '@/lib/invoices/payment-tx';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { voidPaymentSchema } from '@/lib/validations/payment';
import { revalidatePath } from 'next/cache';

/**
 * Enterprise-grade Audited Payment Void Action (Anti-Fraud & MCA Rule 3 Compliant).
 * Replaces un-audited hard-deletion with an immutable soft-void and writes to audit_log.
 */
export const voidPayment = createAuthenticatedAction(
  voidPaymentSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Your account is not linked to a business profile.', { code: 'NO_BUSINESS_LINKED' });
    }

    try {
      const requestContext = await getAuditRequestContext();
      const result = await withTransactionRetry(() =>
        db.transaction((tx) =>
          voidPaymentInTransaction(tx, {
            businessId,
            userId: context.appUser.id,
            operatorDisplayName: context.appUser.display_name,
            requestContext,
            input,
          }),
        ),
      );

      revalidatePath('/invoices');
      revalidatePath(`/invoices/${result.invoiceId}`);

      return {
        success: result.success,
        voidedPaymentId: result.voidedPaymentId,
        newPaymentStatus: result.newPaymentStatus,
        activeTotalPaise: result.activeTotalPaise,
      };
    } catch (error: unknown) {
      throw toThrowable(error);
    }
  },
  'void-payment',
  { rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'void-payment' } },
);
