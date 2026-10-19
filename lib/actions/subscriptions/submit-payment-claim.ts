'use server';

import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { subscriptionClaimSchema } from '@/lib/validations/subscription';
import { db } from '@/lib/db/client';
import { subscriptionRequests, businesses } from '@/lib/db/schema';
import { PLAN_PRICING } from '@/lib/subscriptions/entitlements';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { uploadFileToStorage, getSignedDownloadUrl } from '@/lib/storage/idrive';
import { resend } from '@/lib/email/resend';
import { SubscriptionRequestEmail } from '@/lib/email/templates/subscription-request-email';
import { formatPaiseAsInr } from '@/lib/money';
import { auth } from '@/lib/auth/server';

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
        'You already have a payment verification request pending. Please wait for our team to review it.',
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
        'This payment transaction reference/UTR has already been submitted.',
        { code: 'DUPLICATE_REFERENCE' }
      );
    }

    let screenshotKey: string | null = null;

    // 4. Handle base64 image upload if provided
    if (input.screenshot_base64) {
      try {
        const mimeType = input.screenshot_mime || 'image/jpeg';
        const extension = mimeType.split('/')[1] || 'jpg';

        // Remove base64 data header if present (e.g. data:image/png;base64,)
        const base64Data = input.screenshot_base64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        screenshotKey = `payment-screenshots/${businessId}/${input.payment_reference}.${extension}`;

        await uploadFileToStorage(screenshotKey, buffer, mimeType);
      } catch (err: unknown) {
        console.error('[submitPaymentClaim] Screenshot S3 upload failed:', err);
        throw new ActionError('Failed to upload the payment screenshot to S3. Please try again.', {
          code: 'UPLOAD_FAILED',
        });
      }
    }

    // 5. Insert record into database using authoritative server-side price
    let requestRecord;
    try {
      const [record] = await db
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
      requestRecord = record;
    } catch (err: unknown) {
      const dbErr = err as { code?: string; message?: string };
      if (dbErr.code === '23505' || dbErr.message?.includes('unique')) {
        throw new ActionError('This payment transaction reference/UTR has already been submitted.', {
          code: 'DUPLICATE_REFERENCE',
        });
      }
      console.error('[submitPaymentClaim] DB insert failed:', err);
      throw new ActionError('Failed to record payment claim. Please check your reference and try again.', {
        code: 'DB_INSERT_FAILED',
      });
    }

    // 6. Send Email notification to Super Admins (via Resend)
    const adminEmailsEnv = process.env.PLATFORM_ADMIN_EMAILS || '';
    const adminEmails = adminEmailsEnv.split(',').map((e) => e.trim()).filter(Boolean);

    if (adminEmails.length > 0) {
      try {
        const session = await auth.getSession();
        const ownerEmail = session?.data?.user?.email || 'No email';
        const amountFormatted = formatPaiseAsInr(authoritativeAmountPaise);

        // Generate a temporary signed S3 URL for the admin to view the screenshot (expires in 7 days)
        const screenshotUrl = screenshotKey ? await getSignedDownloadUrl(screenshotKey, 604800) : null;

        const approveLink = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/admin?request=${requestRecord.id}`;

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

        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
          to: adminEmails,
          subject: `🔔 Payment Claim: ${business.legal_name} - ${input.plan_name.toUpperCase()}`,
          react: emailContent,
        });
      } catch (err: unknown) {
        // Log error but don't fail the action, as the DB request was successfully saved
        console.error('[submitPaymentClaim] Email notification failed to send:', err);
      }
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
