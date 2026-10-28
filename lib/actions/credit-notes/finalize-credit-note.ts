'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { db } from '@/lib/db/client';
import { toBusyActionError, withTransactionRetry } from '@/lib/db/transaction';
import { finalizeDraftCreditNoteInTransaction } from '@/lib/invoices/finalize-credit-note-tx';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { archiveCreditNotePdf } from '@/lib/storage/archive-credit-note';
import { finalizeCreditNoteSchema } from '@/lib/validations/credit-note';
import { revalidatePath } from 'next/cache';

export const finalizeCreditNote = createAuthenticatedAction(
  finalizeCreditNoteSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Your account is not linked to a business profile.', { code: 'NO_BUSINESS_LINKED' });
    }

    try {
      const result = await withTransactionRetry(() =>
        db.transaction((tx) =>
          finalizeDraftCreditNoteInTransaction(tx, { creditNoteId: input.id, businessId }),
        ),
      );

      // Asynchronously archive PDF (non-blocking best effort)
      archiveCreditNotePdf(result.id).catch((err) => {
        console.error(`Background archival failed for credit note ${result.id}:`, err);
      });

      // Revalidate paths only AFTER commit
      revalidatePath(`/invoices/${result.originalInvoiceId}`);
      revalidatePath(`/credit-notes/${result.id}`);
      revalidatePath('/invoices');
      revalidatePath('/dashboard');
      revalidatePath('/reports');

      return {
        id: result.id,
        creditNoteNumber: result.creditNoteNumber,
      };
    } catch (error: unknown) {
      if (error instanceof ActionError) throw error;
      const busy = toBusyActionError(error);
      if (busy) throw busy;
      logError('finalize-credit-note', error, { creditNoteId: input.id });
      throw new ActionError('We could not finalize the credit note. Please try again.', { code: 'FINALIZE_FAILED' });
    }
  },
  'finalize-credit-note',
  {
    rateLimit: {
      limiter: sensitiveActionLimiter,
      keyPrefix: 'finalize-credit-note',
    },
  },
);
