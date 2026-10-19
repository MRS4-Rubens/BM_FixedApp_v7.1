'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { subscriptionRequests, businesses } from '@/lib/db/schema';
import { auth } from '@/lib/auth/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';

const processRequestSchema = z.object({
  request_id: z.string().uuid('Invalid request ID'),
  action: z.enum(['approve', 'reject']),
  reject_reason: z.string().optional(),
});

export const processSubscriptionClaim = createAuthenticatedAction(
  processRequestSchema,
  async (input) => {
    // 1. Authorize user by checking session email against PLATFORM_ADMIN_EMAILS env variable
    const adminEmailsEnv = process.env.PLATFORM_ADMIN_EMAILS || '';
    const adminEmails = adminEmailsEnv.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

    const session = await auth.getSession();
    const userEmail = session?.data?.user?.email?.toLowerCase();

    if (!userEmail || !adminEmails.includes(userEmail)) {
      throw new ActionError('Unauthorized: Only Platform Admins can perform this action.', {
        code: 'UNAUTHORIZED_ACCESS',
      });
    }

    // 2. Fetch the target payment claim request
    const reqResult = await db
      .select()
      .from(subscriptionRequests)
      .where(eq(subscriptionRequests.id, input.request_id));
      
    if (reqResult.length === 0) {
      throw new ActionError('Subscription claim request not found.', { code: 'REQUEST_NOT_FOUND' });
    }
    const claim = reqResult[0];

    if (claim.status !== 'pending') {
      throw new ActionError(`This request has already been ${claim.status}.`, {
        code: 'ALREADY_PROCESSED',
      });
    }

    const now = new Date();

    try {
      await db.transaction(async (tx) => {
        if (input.action === 'approve') {
          // Fetch current subscription expiry to preserve remaining prepaid validity on early renewals
          const [existingBiz] = await tx
            .select({
              subscription_ends_at: businesses.subscription_ends_at,
            })
            .from(businesses)
            .where(eq(businesses.id, claim.business_id))
            .limit(1);

          const currentExpiry = existingBiz?.subscription_ends_at
            ? new Date(existingBiz.subscription_ends_at)
            : null;

          const baseDate =
            currentExpiry && !isNaN(currentExpiry.getTime()) && currentExpiry.getTime() > now.getTime()
              ? new Date(currentExpiry.getTime())
              : new Date(now.getTime());

          // Calculate the subscription end date based on billing cycle
          const endDate = new Date(baseDate);
          if (claim.billing_cycle === 'yearly') {
            endDate.setFullYear(endDate.getFullYear() + 1);
          } else {
            endDate.setMonth(endDate.getMonth() + 1);
          }

          // A. Update the subscription request to approved
          await tx
            .update(subscriptionRequests)
            .set({
              status: 'approved',
              approved_at: now,
              updated_at: now,
            })
            .where(eq(subscriptionRequests.id, input.request_id));

          // B. Update the business profile subscription details
          await tx
            .update(businesses)
            .set({
              subscription_plan: claim.plan_name,
              subscription_status: 'active',
              subscription_activated_at: now,
              subscription_ends_at: endDate,
              active_utr_no: claim.payment_reference,
              updated_at: now,
            })
            .where(eq(businesses.id, claim.business_id));
        } else {
          // Reject action
          await tx
            .update(subscriptionRequests)
            .set({
              status: 'rejected',
              reject_reason: input.reject_reason || 'Verification failed. Please check details.',
              updated_at: now,
            })
            .where(eq(subscriptionRequests.id, input.request_id));
        }
      });
    } catch (err: unknown) {
      if (err instanceof ActionError) throw err;
      console.error('[processSubscriptionClaim] DB transaction failed:', err);
      throw new ActionError('Failed to process request. Please try again.', {
        code: 'TRANSACTION_FAILED',
      });
    }

    // 3. Flush cache tags/paths for admin console, checkout, settings, and dashboard status
    revalidatePath('/admin');
    revalidatePath('/checkout');
    revalidatePath('/settings');
    revalidatePath('/dashboard');

    return {
      requestId: claim.id,
      status: input.action === 'approve' ? 'approved' : 'rejected',
    };
  },
  'process-subscription-claim'
);
