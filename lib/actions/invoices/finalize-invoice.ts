'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { EDITOR_ROLES } from '@/lib/auth/rbac';
import { toThrowable } from '@/lib/actions/_shared/action-error-mapping';
import { FINALIZE_INVOICE_MAPPINGS } from '@/lib/actions/_shared/pg-constraint-mappings';
import { ActionError } from '@/lib/actions/_shared/errors';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { db } from '@/lib/db/client';
import { withTransactionRetry } from '@/lib/db/transaction';
import { finalizeDraftInvoiceInTransaction } from '@/lib/invoices/finalize-invoice-tx';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { scheduleArchival } from '@/lib/storage/schedule-archival';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

export const finalizeInvoice = createAuthenticatedAction(
  z.object({
    id: z.string().uuid(),
    confirm_cross_financial_year: z.boolean().optional(),
  }),
  async ({ id, confirm_cross_financial_year }, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Your account is not linked to a business profile.', { code: 'NO_BUSINESS_LINKED' });
    }

    try {
      const requestContext = await getAuditRequestContext();
      const result = await withTransactionRetry(() =>
        db.transaction((tx) =>
          finalizeDraftInvoiceInTransaction(tx, {
            invoiceId: id,
            businessId,
            actorUserId: context.appUser.id,
            requestContext,
            confirmCrossFinancialYear: confirm_cross_financial_year,
          }),
        ),
      );

      // Cache invalidation only AFTER commit.
      revalidatePath('/invoices');
      revalidatePath(`/invoices/${id}`);

      // Archival scheduled via Next.js after() to run reliably on serverless after response.
      scheduleArchival('invoice', id);

      return result;
    } catch (error: unknown) {
      throw toThrowable(error, FINALIZE_INVOICE_MAPPINGS);
    }
  },
  'finalize-invoice',
  {
    roles: EDITOR_ROLES,
    rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'finalize-invoice', outage: 'fail-open' },
    requireActiveSubscription: true,
  },
);
