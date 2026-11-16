'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { EDITOR_ROLES } from '@/lib/auth/rbac';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { toBusyActionError, withTransactionRetry } from '@/lib/db/transaction';
import {
  assertMayEmailCustomers,
  enforceDailyEmailCap,
  loadSenderBusiness,
} from '@/lib/email/send-guards';
import { sendCustomerEmail } from '@/lib/email/send-customer-email';
import { sanitizeEmailHeaderText } from '@/lib/email/send-policy';
import { PaymentReminderEmail } from '@/lib/email/templates/payment-reminder-email';
import {
  claimReminderInTransaction,
  releaseReminderClaim,
  type ReminderClaim,
} from '@/lib/invoices/email-claim-tx';
import { formatPaiseAsInr } from '@/lib/money';
import { emailBurstLimiter } from '@/lib/rate-limit/upstash';

const SendPaymentReminderSchema = z
  .object({
    invoiceId: z.string().uuid(),
  })
  .strict();

function formatIsoDateForEmail(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (match) {
    const [, y, m, d] = match;
    return `${d}/${m}/${y}`;
  }
  return isoDate;
}

export const sendPaymentReminder = createAuthenticatedAction(
  SendPaymentReminderSchema,
  async (input, { appUser }): Promise<{ success: true }> => {
    if (!appUser.business_id) {
      throw new ActionError('Your account is not linked to a business profile.', {
        code: 'NO_BUSINESS_LINKED',
      });
    }

    const { invoiceId } = input;
    const businessId = appUser.business_id;

    // 1. Load sender business profile
    const business = await loadSenderBusiness(businessId);

    // 2. Verification and suspension checks
    await assertMayEmailCustomers(business);

    // 3. Atomically claim reminder under invoice row lock
    let claim: ReminderClaim;
    try {
      claim = await withTransactionRetry(() =>
        db.transaction((tx) =>
          claimReminderInTransaction(tx, {
            businessId,
            invoiceId,
          }),
        ),
      );
    } catch (error: unknown) {
      const busyError = toBusyActionError(error);
      if (busyError !== null) throw busyError;
      throw error;
    }

    // 4. Send email (with compensation rollback on failure)
    try {
      await enforceDailyEmailCap(business.id);

      const safeBusinessName = sanitizeEmailHeaderText(business.legal_name);
      const safeInvoiceNumber = sanitizeEmailHeaderText(claim.invoiceNumber);
      const dueDateFormatted = formatIsoDateForEmail(claim.dueDate);

      await sendCustomerEmail({
        kind: 'reminder',
        invoiceId: claim.invoiceId,
        claimedAt: claim.claimedAt,
        to: claim.customer.email,
        subject: `Payment Reminder: Invoice ${safeInvoiceNumber} from ${safeBusinessName}`,
        senderContactEmail: business.email,
        react: PaymentReminderEmail({
          businessName: safeBusinessName,
          customerName: claim.customer.name,
          invoiceNumber: claim.invoiceNumber,
          dueDate: dueDateFormatted,
          daysOverdue: claim.daysOverdue,
          amountDueFormatted: formatPaiseAsInr(claim.balanceDuePaise),
          sender: {
            legalName: business.legal_name,
            gstin: business.gstin,
            city: business.city,
            contactEmail: business.email,
            phone: business.phone,
          },
        }),
      });
    } catch (error: unknown) {
      await releaseReminderClaim(db, claim);
      throw error;
    }

    // 5. Post-commit cache revalidation
    revalidatePath(`/invoices/${invoiceId}`);

    return { success: true };
  },
  'send-payment-reminder',
  {
    roles: EDITOR_ROLES,
    rateLimit: { limiter: emailBurstLimiter, keyPrefix: 'payment-reminder', outage: 'fail-closed' },
    requireActiveSubscription: true,
  },
);
