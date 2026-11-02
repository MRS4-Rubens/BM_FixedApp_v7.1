'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { db } from '@/lib/db/client';
import { invoiceLineItems, invoices } from '@/lib/db/schema';
import { setLocalLockTimeout, toBusyActionError, withTransactionRetry } from '@/lib/db/transaction';
import { lockDraftInvoice } from '@/lib/invoices/document-locks';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';

const deleteInvoiceDraftSchema = z.object({
  id: z.string().uuid('Valid invoice ID is required'),
});

export const deleteInvoiceDraft = createAuthenticatedAction(
  deleteInvoiceDraftSchema,
  async ({ id }, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Your account is not linked to a business profile.', { code: 'NO_BUSINESS_LINKED' });
    }

    try {
      await withTransactionRetry(() =>
        db.transaction(async (tx) => {
          await setLocalLockTimeout(tx);
          // Lock + tenant-scope + draft-only guard (NOT_FOUND for foreign/unknown ids; ALREADY_FINALIZED otherwise).
          await lockDraftInvoice(
            tx,
            { id, businessId },
            { alreadyFinalized: 'Finalized invoices cannot be deleted under GST law. They are permanent tax records.' },
          );
          await tx.delete(invoiceLineItems).where(eq(invoiceLineItems.invoice_id, id));
          const deleted = await tx
            .delete(invoices)
            .where(and(eq(invoices.id, id), eq(invoices.business_id, businessId), eq(invoices.lifecycle_status, 'draft')))
            .returning({ id: invoices.id });
          if (deleted.length !== 1) {
            throw new ActionError('This draft changed while deleting. Please refresh and try again.', { code: 'CONFLICT' });
          }
        }),
      );
    } catch (error: unknown) {
      if (error instanceof ActionError) throw error;
      const busy = toBusyActionError(error);
      if (busy) throw busy;
      logError('delete-invoice-draft', error, { invoiceId: id });
      throw new ActionError('We could not delete the draft. Please try again.', { code: 'TRANSACTION_FAILED' });
    }

    revalidatePath('/invoices');
    revalidatePath('/dashboard');
    return { success: true as const };
  },
  'delete-invoice-draft',
  {
    rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'delete-invoice-draft' },
    requireActiveSubscription: true,
  },
);

