'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { OWNER_ONLY } from '@/lib/auth/rbac';
import { toThrowable } from '@/lib/actions/_shared/action-error-mapping';
import { ActionError } from '@/lib/actions/_shared/errors';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { CreditNoteRuleError } from '@/lib/credit-notes/derivation';
import { db } from '@/lib/db/client';
import { withTransactionRetry } from '@/lib/db/transaction';
import { finalizeDraftCreditNoteInTransaction } from '@/lib/invoices/finalize-credit-note-tx';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { scheduleArchival } from '@/lib/storage/schedule-archival';
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
      const requestContext = await getAuditRequestContext();
      const result = await withTransactionRetry(() =>
        db.transaction((tx) =>
          finalizeDraftCreditNoteInTransaction(tx, {
            creditNoteId: input.id,
            businessId,
            actorUserId: context.appUser.id,
            requestContext,
          }),
        ),
      );

      // Archival scheduled via Next.js after() to run reliably on serverless after response.
      scheduleArchival('credit_note', result.id);

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
      if (error instanceof CreditNoteRuleError) throw new ActionError(error.message, { code: error.code });
      throw toThrowable(error);
    }
  },
  'finalize-credit-note',
  {
    roles: OWNER_ONLY,
    rateLimit: {
      limiter: sensitiveActionLimiter,
      keyPrefix: 'finalize-credit-note',
    },
    requireActiveSubscription: true,
  },
);
