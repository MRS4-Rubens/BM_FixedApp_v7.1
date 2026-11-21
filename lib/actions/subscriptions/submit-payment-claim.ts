'use server';

import * as React from 'react';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { OWNER_ONLY } from '@/lib/auth/rbac';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { subscriptionClaimSchema } from '@/lib/validations/subscription';
import { db } from '@/lib/db/client';
import { subscriptionRequests, businesses } from '@/lib/db/schema';
import { PLAN_PRICING } from '@/lib/subscriptions/entitlements';
import { isPurchasablePlan } from '@/lib/subscriptions/plan-catalog';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { uploadFileToStorage, deleteFileFromStorage } from '@/lib/storage/idrive';
import { getMailer } from '@/lib/email/mailer';
import { getAdminEnv, getAppEnv } from '@/lib/env';
import { appSender, billingInbox } from '@/lib/email/addresses';
import { SubscriptionRequestEmail } from '@/lib/email/templates/subscription-request-email';
import { formatPaiseAsInr } from '@/lib/money';
import { getRequestSession } from '@/lib/auth/request-session';
import { classifyClaimInsertError } from '@/lib/subscriptions/claim-errors';
import { requireValidUpload, buildUploadKey, IMAGE_MIMES } from '@/lib/security/upload';
import { getAuthoritativePayeeConfig } from '@/lib/config/payee';
import { PAYMENT_SCREENSHOT_MAX_BYTES } from '@/lib/security/upload-limits';

const SCREENSHOT_MAX_BYTES = PAYMENT_SCREENSHOT_MAX_BYTES; // 50 KB (B9b): the checkout shrinks screenshots to fit

const NEUTRAL_DUPLICATE_MESSAGE =
  'This payment reference could not be accepted. Please double-check the UTR/transaction ID; if it is correct, contact support and quote it.';
const PENDING_CLAIM_MESSAGE =
  'You already have a payment verification request pending. Please wait for our team to review it.';

export const submitPaymentClaim = createAuthenticatedAction(
  subscriptionClaimSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Your user account is not linked to a business profile.', {
        code: 'NO_BUSINESS_PROFILE',
      });
    }

    if (!isPurchasablePlan(input.plan_name)) {
      throw new ActionError('This plan is not available.', {
        code: 'PLAN_NOT_AVAILABLE',
      });
    }

    // 1. Compute authoritative server-side pricing (never trust client-supplied amount_paise)
    const planPricing = PLAN_PRICING[input.plan_name];
    if (!planPricing) {
      throw new ActionError('Invalid subscription plan selected.', {
        code: 'INVALID_PLAN',
      });
    }

    const authoritativeAmountPaise =
      input.billing_cycle === 'yearly'
        ? planPricing.yearlyPaise
        : planPricing.monthlyPaise;

    if (authoritativeAmountPaise <= 0) {
      throw new ActionError('Selected plan does not require a payment claim.', {
        code: 'INVALID_PLAN',
      });
    }

    // 2. Fetch business details
    const bizResult = await db.select().from(businesses).where(eq(businesses.id, businessId));
    if (bizResult.length === 0) {
      throw new ActionError('Business profile not found.', { code: 'BUSINESS_NOT_FOUND' });
    }
    const business = bizResult[0];

    // 3. Guard against duplicate pending claims for this business or duplicate UTRs before S3 upload
    const existingPending = await db
      .select({ id: subscriptionRequests.id })
      .from(subscriptionRequests)
      .where(
        and(
          eq(subscriptionRequests.business_id, businessId),
          eq(subscriptionRequests.status, 'pending')
        )
      )
      .limit(1);

    if (existingPending.length > 0) {
      throw new ActionError(
        PENDING_CLAIM_MESSAGE,
        { code: 'PENDING_CLAIM_EXISTS' }
      );
    }

    const duplicateUtr = await db
      .select({ id: subscriptionRequests.id })
      .from(subscriptionRequests)
      .where(eq(subscriptionRequests.payment_reference, input.payment_reference))
      .limit(1);

    if (duplicateUtr.length > 0) {
      throw new ActionError(
        NEUTRAL_DUPLICATE_MESSAGE,
        { code: 'DUPLICATE_REFERENCE' }
      );
    }

    let screenshotKey: string | null = null;

    // 4. Handle base64 image upload if provided
    if (input.screenshot_base64) {
      // Validate the real bytes first; validation errors are specific, user-safe ActionErrors.
      const screenshot = requireValidUpload(input.screenshot_base64, {
        maxBytes: SCREENSHOT_MAX_BYTES,
        allowed: IMAGE_MIMES,
      });
      const key = buildUploadKey(`payment-screenshots/${businessId}`, screenshot.ext);
      try {
        await uploadFileToStorage(key, screenshot.buffer, screenshot.mime, {
          contentDisposition: 'attachment',
          cacheControl: 'private, no-store',
        });
      } catch (err: unknown) {
        logError('submit-payment-claim', err, { stage: 'screenshot-upload' });
        throw new ActionError('Failed to upload the payment screenshot. Please try again.', {
          code: 'UPLOAD_FAILED',
        });
      }
      screenshotKey = key;
    }

    // 4b. Capture snapshot of active payee details at time of payment (Pattern 3)
    const activePayee = await getAuthoritativePayeeConfig();
    let paidToVpa: string | null = null;
    let paidToAccount: string | null = null;
    let paidToIfsc: string | null = null;

    if (activePayee.status === 'configured') {
      if (input.payment_method === 'upi_qr' || input.payment_method === 'upi_id') {
        paidToVpa = activePayee.config.upiId;
      } else if (input.payment_method === 'bank_transfer') {
        paidToAccount = activePayee.config.accNo;
        paidToIfsc = activePayee.config.ifsc;
      }
    }

    // 5. Insert record into database using authoritative server-side price inside a transaction
    let requestRecord: typeof subscriptionRequests.$inferSelect;
    try {
      requestRecord = await db.transaction(async (tx) => {
        // Serialise concurrent submissions of THIS business (lock order: business -> request).
        const [lockedBusiness] = await tx
          .select({ id: businesses.id })
          .from(businesses)
          .where(eq(businesses.id, businessId))
          .for('update');
        if (!lockedBusiness) throw new ActionError('Business profile not found.', { code: 'BUSINESS_NOT_FOUND' });
        const [pending] = await tx
          .select({ id: subscriptionRequests.id })
          .from(subscriptionRequests)
          .where(and(eq(subscriptionRequests.business_id, businessId), eq(subscriptionRequests.status, 'pending')))
          .limit(1);
        if (pending) throw new ActionError(PENDING_CLAIM_MESSAGE, { code: 'PENDING_CLAIM_EXISTS' });
        const [record] = await tx
          .insert(subscriptionRequests)
          .values({
            business_id: businessId,
            user_id: context.appUser.id,
            plan_name: input.plan_name,
            billing_cycle: input.billing_cycle,
            amount_paise: authoritativeAmountPaise,
            payment_method: input.payment_method,
            payment_reference: input.payment_reference,
            paid_to_vpa: paidToVpa,
            paid_to_account: paidToAccount,
            paid_to_bank_ifsc: paidToIfsc,
            screenshot_storage_key: screenshotKey,
            status: 'pending',
          })
          .returning();
        if (!record) {
          throw new ActionError('Failed to record payment claim. Please check your reference and try again.', {
            code: 'DB_INSERT_FAILED',
          });
        }
        return record;
      });
    } catch (err: unknown) {
      if (screenshotKey) {
        deleteFileFromStorage(screenshotKey).catch((cleanupErr: unknown) => {
          logError('submit-payment-claim', cleanupErr, { stage: 'orphan-screenshot-cleanup' });
        });
      }
      if (err instanceof ActionError) throw err;
      const failure = classifyClaimInsertError(err);
      if (failure === 'PENDING_CLAIM_EXISTS') {
        throw new ActionError(PENDING_CLAIM_MESSAGE, { code: 'PENDING_CLAIM_EXISTS' });
      }
      if (failure === 'DUPLICATE_REFERENCE') {
        throw new ActionError(NEUTRAL_DUPLICATE_MESSAGE, { code: 'DUPLICATE_REFERENCE' });
      }
      logError('submit-payment-claim', err);
      throw new ActionError('Failed to record payment claim. Please check your reference and try again.', {
        code: 'DB_INSERT_FAILED',
      });
    }

    // 6. Notify billing (BILLING_EMAIL, e.g. a +billing alias) or, if unset, the Super Admins (Brevo, lib/email/mailer.ts)
    try {
      const adminEmails = getAdminEnv().PLATFORM_ADMIN_EMAILS;
      const billingTo = billingInbox();
      const recipients = billingTo ? [billingTo] : [...adminEmails];
      if (recipients.length > 0) {
        const session = await getRequestSession();
        const ownerEmail = session?.data?.user?.email || 'No email';
        const amountFormatted = formatPaiseAsInr(authoritativeAmountPaise);

        const hasScreenshot = screenshotKey !== null;

        const approveLink = `${getAppEnv().NEXT_PUBLIC_APP_URL}/admin?request=${requestRecord.id}`;

        const emailContent = React.createElement(SubscriptionRequestEmail, {
          businessName: business.legal_name,
          ownerEmail: ownerEmail,
          gstin: business.gstin || null,
          planName: input.plan_name,
          cycle: input.billing_cycle,
          amountFormatted,
          utr: input.payment_reference,
          paymentMethod: input.payment_method,
          hasScreenshot,
          approveLink,
        });

        await getMailer().emails.send({
          from: appSender('billing'),
          to: recipients,
          subject: `🔔 Payment Claim: ${business.legal_name} - ${input.plan_name.toUpperCase()}`,
          react: emailContent,
        });
      }
    } catch (err: unknown) {
      // Log error but don't fail the action, as the DB request was successfully saved
      logError('submit-payment-claim', err, { stage: 'admin-notification' });
    }

    revalidatePath('/settings');
    revalidatePath('/checkout');
    revalidatePath('/admin');

    return {
      requestId: requestRecord.id,
      status: requestRecord.status,
    };
  },
  'submit-payment-claim',
  {
    roles: OWNER_ONLY,
    rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'submit-payment-claim', outage: 'fail-closed' },
  }
);
