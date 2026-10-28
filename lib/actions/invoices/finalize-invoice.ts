'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { db } from '@/lib/db/client';
import { toBusyActionError, withTransactionRetry } from '@/lib/db/transaction';
import { finalizeDraftInvoiceInTransaction } from '@/lib/invoices/finalize-invoice-tx';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { archiveInvoicePdf } from '@/lib/storage/archive-invoice';
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
      const result = await withTransactionRetry(() =>
        db.transaction((tx) =>
          finalizeDraftInvoiceInTransaction(tx, {
            invoiceId: id,
            businessId,
            confirmCrossFinancialYear: confirm_cross_financial_year,
          }),
        ),
      );

      // Cache invalidation only AFTER commit.
      revalidatePath('/invoices');
      revalidatePath(`/invoices/${id}`);

      // Archival stays decoupled and fire-and-forget (API-008 will harden it). Keep the existing .then(...) block unchanged.
      archiveInvoicePdf(id).then((archivalResult) => {
        if (!archivalResult.success) {
          logError('finalize-invoice', new Error(archivalResult.error || 'Archival failed'), { invoiceId: id });
        }
      });

      return result;
    } catch (error: unknown) {
      if (error instanceof ActionError) throw error;
      const busy = toBusyActionError(error);
      if (busy) throw busy;
      logError('finalize-invoice', error, { invoiceId: id });
      throw new ActionError('We could not finalize the invoice. Please try again.', { code: 'TRANSACTION_FAILED' });
    }
  },
  'finalize-invoice',
  { rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'finalize-invoice' } },
);
