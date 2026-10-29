'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { db, type DbTransaction } from '@/lib/db/client';
import { subscriptionRequests, businesses } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { processSubscriptionRequestSchema } from '@/lib/validations/admin-subscription';
import {
  addBillingCycleUtc,
  resolveApprovalBase,
  isBillingCycle,
  isPaidPlanName,
} from '@/lib/subscriptions/billing-period';

const DEFAULT_REJECT_REASON = 'Verification failed. Please check details.';

async function alreadyProcessed(tx: DbTransaction, requestId: string): Promise<ActionError> {
  const [current] = await tx
    .select({ status: subscriptionRequests.status })
    .from(subscriptionRequests)
    .where(eq(subscriptionRequests.id, requestId))
    .limit(1);
  if (!current) return new ActionError('Subscription claim request not found.', { code: 'REQUEST_NOT_FOUND' });
  return new ActionError(`This request has already been ${current.status}.`, { code: 'ALREADY_PROCESSED' });
}

export const processSubscriptionClaim = createAuthenticatedAction(
  processSubscriptionRequestSchema,
  async (input) => {
    const now = new Date();
    let outcome: { requestId: string; status: 'approved' | 'rejected' };
    try {
      outcome = await db.transaction(async (tx): Promise<{ requestId: string; status: 'approved' | 'rejected' }> => {
        // 1. Locate the claim (unlocked read, only to learn its business and validate immutable fields).
        const [claim] = await tx
          .select()
          .from(subscriptionRequests)
          .where(eq(subscriptionRequests.id, input.request_id))
          .limit(1);
        if (!claim) throw new ActionError('Subscription claim request not found.', { code: 'REQUEST_NOT_FOUND' });

        if (input.action === 'reject') {
          const [rejected] = await tx
            .update(subscriptionRequests)
            .set({
              status: 'rejected',
              reject_reason: input.reject_reason ? input.reject_reason : DEFAULT_REJECT_REASON,
              updated_at: now,
            })
            .where(and(eq(subscriptionRequests.id, claim.id), eq(subscriptionRequests.status, 'pending')))
            .returning({ id: subscriptionRequests.id });
          if (!rejected) throw await alreadyProcessed(tx, claim.id);
          return { requestId: claim.id, status: 'rejected' as const };
        }

        // 2. APPROVE — validate what we are about to grant.
        if (!isBillingCycle(claim.billing_cycle)) {
          throw new ActionError('This request has an unsupported billing cycle and cannot be approved.', {
            code: 'INVALID_BILLING_CYCLE',
          });
        }
        if (!isPaidPlanName(claim.plan_name)) {
          throw new ActionError('This request has an unsupported plan and cannot be approved.', {
            code: 'INVALID_PLAN',
          });
        }

        // 3. Lock the business FIRST (global lock order: business -> request), then flip the request atomically.
        const [business] = await tx
          .select({ id: businesses.id, subscription_ends_at: businesses.subscription_ends_at })
          .from(businesses)
          .where(eq(businesses.id, claim.business_id))
          .for('update');
        if (!business) throw new ActionError('Business not found for this request.', { code: 'BUSINESS_NOT_FOUND' });

        const [approved] = await tx
          .update(subscriptionRequests)
          .set({ status: 'approved', approved_at: now, updated_at: now })
          .where(and(eq(subscriptionRequests.id, claim.id), eq(subscriptionRequests.status, 'pending')))
          .returning({ id: subscriptionRequests.id });
        if (!approved) throw await alreadyProcessed(tx, claim.id); // a parallel approver won: NO business write

        // 4. Extend from the LOCKED row: exactly one cycle, preserving prepaid validity.
        const endDate = addBillingCycleUtc(
          resolveApprovalBase(business.subscription_ends_at, now),
          claim.billing_cycle,
        );
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
        return { requestId: claim.id, status: 'approved' as const };
      });
    } catch (err: unknown) {
      if (err instanceof ActionError) throw err;
      logError('process-subscription-claim', err, { requestId: input.request_id });
      throw new ActionError('Failed to process request. Please try again.', { code: 'TRANSACTION_FAILED' });
    }

    revalidatePath('/admin');
    revalidatePath('/checkout');
    revalidatePath('/settings');
    revalidatePath('/dashboard');

    return outcome;
  },
  'process-subscription-claim',
  { requirePlatformAdmin: true }
);
