'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { EDITOR_ROLES } from '@/lib/auth/rbac';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { db } from '@/lib/db/client';
import { toBusyActionError, withTransactionRetry } from '@/lib/db/transaction';
import {
  assertMayEmailCustomers,
  enforceDailyEmailCap,
  loadSenderBusiness,
} from '@/lib/email/send-guards';
import { sendCustomerEmail } from '@/lib/email/send-customer-email';
import { sanitizeEmailHeaderText } from '@/lib/email/send-policy';
import { InvoiceDeliveryEmail } from '@/lib/email/templates/invoice-delivery-email';
import {
  claimInvoiceEmailInTransaction,
  releaseInvoiceEmailClaim,
  type InvoiceEmailClaim,
} from '@/lib/invoices/email-claim-tx';
import { formatPaiseAsInr } from '@/lib/money';
import { emailBurstLimiter } from '@/lib/rate-limit/upstash';
import { sanitizeFilename } from '@/lib/security/upload';

const EmailInvoiceSchema = z
  .object({
    invoiceId: z.string().uuid(),
  })
  .strict();

function formatIsoDateForEmail(isoDate: string | null): string {
  if (!isoDate) return 'N/A';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (match) {
    const [, y, m, d] = match;
    return `${d}/${m}/${y}`;
  }
  return isoDate;
}

export const emailInvoice = createAuthenticatedAction(
  EmailInvoiceSchema,
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

    // 3. Atomically claim invoice email under invoice row lock
    let claim: InvoiceEmailClaim;
    try {
      claim = await withTransactionRetry(() =>
        db.transaction((tx) =>
          claimInvoiceEmailInTransaction(tx, {
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

      const { getFileBuffer } = await import('@/lib/storage/idrive');
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await getFileBuffer(claim.pdfStorageKey);
      } catch (error: unknown) {
        logError('email-invoice', error, { invoiceId });
        throw new ActionError(
          'Could not fetch the invoice PDF from storage. Please try again later.',
          { code: 'PDF_FETCH_FAILED' },
        );
      }

      const safeBusinessName = sanitizeEmailHeaderText(business.legal_name);
      const safeInvoiceNumber = sanitizeEmailHeaderText(claim.invoiceNumber);

      const invoiceDateFormatted = formatIsoDateForEmail(claim.invoiceDate);
      const dueDateFormatted = claim.dueDate ? formatIsoDateForEmail(claim.dueDate) : null;

      await sendCustomerEmail({
        kind: 'invoice',
        invoiceId: claim.invoiceId,
        claimedAt: claim.claimedAt,
        to: claim.customer.email,
        subject: `Invoice ${safeInvoiceNumber} from ${safeBusinessName}`,
        senderContactEmail: business.email,
        react: InvoiceDeliveryEmail({
          businessName: safeBusinessName,
          customerName: claim.customer.name,
          invoiceNumber: claim.invoiceNumber,
          invoiceDate: invoiceDateFormatted,
          dueDate: dueDateFormatted,
          grandTotalFormatted: formatPaiseAsInr(claim.grandTotalPaise),
          sender: {
            legalName: business.legal_name,
            gstin: business.gstin,
            city: business.city,
            contactEmail: business.email,
            phone: business.phone,
          },
        }),
        attachments: [
          {
            filename: sanitizeFilename(claim.invoiceNumber, 'pdf'),
            content: pdfBuffer,
          },
        ],
      });
    } catch (error: unknown) {
      await releaseInvoiceEmailClaim(db, claim);
      throw error;
    }

    // 5. Post-commit cache revalidation
    revalidatePath(`/invoices/${invoiceId}`);

    return { success: true };
  },
  'email-invoice',
  {
    roles: EDITOR_ROLES,
    rateLimit: { limiter: emailBurstLimiter, keyPrefix: 'email-invoice', outage: 'fail-closed' },
    requireActiveSubscription: true,
  },
);
