'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { toThrowable } from '@/lib/actions/_shared/action-error-mapping';
import { ActionError } from '@/lib/actions/_shared/errors';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { db } from '@/lib/db/client';
import { withTransactionRetry } from '@/lib/db/transaction';
import { voidCreditNoteInTransaction } from '@/lib/invoices/void-credit-note-tx';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { voidCreditNoteSchema } from '@/lib/validations/credit-note';
import { revalidatePath } from 'next/cache';

/**
 * Enterprise-grade Audited Credit Note Void Action (CGST Rule 53 & GSTR-1 Table 13 Compliant).
 * Replaces hard-deletion with an immutable soft-void, retains serial number for Table 13 (Cancelled Documents),
 * logs in statutory audit_log, and restores the original invoice balance.
 */
export const voidCreditNote = createAuthenticatedAction(
  voidCreditNoteSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Your account is not linked to a business profile.', { code: 'NO_BUSINESS_LINKED' });
    }

    try {
      const requestContext = await getAuditRequestContext();
      const result = await withTransactionRetry(() =>
        db.transaction((tx) =>
          voidCreditNoteInTransaction(tx, {
            businessId,
            userId: context.appUser.id,
            operatorDisplayName: context.appUser.display_name,
            requestContext,
            input,
          }),
        ),
      );

      revalidatePath('/invoices');
      revalidatePath(`/invoices/${result.originalInvoiceId}`);
      revalidatePath('/credit-notes');
      revalidatePath(`/credit-notes/${result.creditNoteId}`);

      return {
        success: result.success,
        status: result.status,
        credit_note_number: result.credit_note_number,
        restored_amount_paise: result.restored_amount_paise,
        invoice_payment_status: result.invoice_payment_status,
      };
    } catch (error: unknown) {
      throw toThrowable(error);
    }
  },
  'void-credit-note',
  {
    rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'void-credit-note' },
    requireActiveSubscription: true,
  },
);
