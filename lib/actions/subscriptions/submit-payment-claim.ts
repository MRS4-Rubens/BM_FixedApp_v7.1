'use server';

import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { subscriptionClaimSchema } from '@/lib/validations/subscription';
import { db } from '@/lib/db/client';
import { subscriptionRequests, businesses } from '@/lib/db/schema';
import { PLAN_PRICING } from '@/lib/subscriptions/entitlements';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { uploadFileToStorage, getSignedDownloadUrl, deleteFileFromStorage } from '@/lib/storage/idrive';
import { getResend } from '@/lib/email/resend';
import { getAdminEnv, getAppEnv, getEmailEnv } from '@/lib/env';
import { SubscriptionRequestEmail } from '@/lib/email/templates/subscription-request-email';
import { formatPaiseAsInr } from '@/lib/money';
import { auth } from '@/lib/auth/server';
import { classifyClaimInsertError } from '@/lib/subscriptions/claim-errors';
import { requireValidUpload, buildUploadKey, IMAGE_MIMES } from '@/lib/security/upload';

const SCREENSHOT_MAX_BYTES = 4 * 1024 * 1024; // module-level const (matches the checkout UI limit)

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
        console.error('[submitPaymentClaim] Screenshot upload failed:', err);
        throw new ActionError('Failed to upload the payment screenshot. Please try again.', {
          code: 'UPLOAD_FAILED',
        });
      }
      screenshotKey = key;
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
          console.warn('[submitPaymentClaim] Best-effort cleanup of orphan screenshot failed:', cleanupErr);
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

    // 6. Send Email notification to Super Admins (via Resend)
    try {
      const adminEmails = getAdminEnv().PLATFORM_ADMIN_EMAILS;
      if (adminEmails.length > 0) {
        const session = await auth.getSession();
        const ownerEmail = session?.data?.user?.email || 'No email';
        const amountFormatted = formatPaiseAsInr(authoritativeAmountPaise);

        // Generate a temporary signed S3 URL for the admin to view the screenshot (expires in 7 days)
        const screenshotUrl = screenshotKey ? await getSignedDownloadUrl(screenshotKey, 604800, { forceDownload: true }) : null;

        const approveLink = `${getAppEnv().NEXT_PUBLIC_APP_URL}/admin?request=${requestRecord.id}`;

        const emailContent = SubscriptionRequestEmail({
          businessName: business.legal_name,
          ownerEmail: ownerEmail,
          gstin: business.gstin || null,
          planName: input.plan_name,
          cycle: input.billing_cycle,
          amountFormatted,
          utr: input.payment_reference,
          paymentMethod: input.payment_method,
          screenshotUrl,
          approveLink,
        });

        await getResend().emails.send({
          from: getEmailEnv().RESEND_FROM_EMAIL,
          to: [...adminEmails],
          subject: `🔔 Payment Claim: ${business.legal_name} - ${input.plan_name.toUpperCase()}`,
          react: emailContent,
        });
      }
    } catch (err: unknown) {
      // Log error but don't fail the action, as the DB request was successfully saved
      console.error('[submitPaymentClaim] Email notification failed to send:', err);
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
  { rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'submit-payment-claim' } }
);
