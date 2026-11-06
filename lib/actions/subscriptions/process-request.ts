'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { writeAudit } from '@/lib/audit/log';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { db, type DbTransaction } from '@/lib/db/client';
import { setLocalLockTimeout, toBusyActionError, withTransactionRetry } from '@/lib/db/transaction';
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
  async (input, context) => {
    const now = new Date();
    const requestContext = await getAuditRequestContext();
    let outcome: { requestId: string; status: 'approved' | 'rejected' };
    try {
      outcome = await withTransactionRetry(() => db.transaction(async (tx): Promise<{ requestId: string; status: 'approved' | 'rejected' }> => {
        await setLocalLockTimeout(tx);

        // 1. Locate the claim (unlocked read, only to learn its business and validate immutable fields).
        const [claim] = await tx
          .select()
          .from(subscriptionRequests)
          .where(eq(subscriptionRequests.id, input.request_id))
          .limit(1);
        if (!claim) throw new ActionError('Subscription claim request not found.', { code: 'REQUEST_NOT_FOUND' });

        // 2. Lock the business FIRST for BOTH approve and reject (global lock order: business -> request).
        // Reject must take it too: its audit_log insert needs a KEY SHARE lock on the business (FK), so a reject
        // that locked the request first would deadlock against an approve holding the business lock.
        const [business] = await tx
          .select({
            id: businesses.id,
            subscription_plan: businesses.subscription_plan,
            subscription_status: businesses.subscription_status,
            subscription_ends_at: businesses.subscription_ends_at,
          })
          .from(businesses)
          .where(eq(businesses.id, claim.business_id))
          .for('update');
        if (!business) throw new ActionError('Business not found for this request.', { code: 'BUSINESS_NOT_FOUND' });

        if (input.action === 'reject') {
          const rejectReason = input.reject_reason ? input.reject_reason : DEFAULT_REJECT_REASON;
          const [rejected] = await tx
            .update(subscriptionRequests)
            .set({
              status: 'rejected',
              reject_reason: rejectReason,
              updated_at: now,
            })
            .where(and(eq(subscriptionRequests.id, claim.id), eq(subscriptionRequests.status, 'pending')))
            .returning({ id: subscriptionRequests.id });
          if (!rejected) throw await alreadyProcessed(tx, claim.id);

          await writeAudit(tx, {
            businessId: claim.business_id,
            actorUserId: context.appUser.id,
            entityType: 'subscription_request',
            entityId: claim.id,
            action: 'reject',
            requestContext,
            metadata: {
              plan_name: claim.plan_name,
              billing_cycle: claim.billing_cycle,
              amount_paise: claim.amount_paise,
              payment_reference: claim.payment_reference,
              reject_reason: rejectReason,
            },
          });

          return { requestId: claim.id, status: 'rejected' as const };
        }

        // 3. APPROVE — validate what we are about to grant.
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

        // 4. Flip the request atomically (the business row is already locked above).
        const [approved] = await tx
          .update(subscriptionRequests)
          .set({ status: 'approved', approved_at: now, updated_at: now })
          .where(and(eq(subscriptionRequests.id, claim.id), eq(subscriptionRequests.status, 'pending')))
          .returning({ id: subscriptionRequests.id });
        if (!approved) throw await alreadyProcessed(tx, claim.id); // a parallel approver won: NO business write

        // 5. Extend from the LOCKED row: exactly one cycle, preserving prepaid validity.
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

        await writeAudit(tx, {
          businessId: claim.business_id,
          actorUserId: context.appUser.id,
          entityType: 'subscription_request',
          entityId: claim.id,
          action: 'approve',
          requestContext,
          metadata: {
            plan_name: claim.plan_name,
            billing_cycle: claim.billing_cycle,
            amount_paise: claim.amount_paise,
            payment_reference: claim.payment_reference,
            previous: {
              subscription_plan: business.subscription_plan,
              subscription_status: business.subscription_status,
              subscription_ends_at: business.subscription_ends_at
                ? new Date(business.subscription_ends_at).toISOString()
                : null,
            },
            subscription_ends_at: endDate.toISOString(),
          },
        });

        return { requestId: claim.id, status: 'approved' as const };
      }));
    } catch (err: unknown) {
      if (err instanceof ActionError) throw err;
      // Lock timeout or deadlock/serialization still failing after retries: safe, retryable BUSY message.
      const busy = toBusyActionError(err);
      if (busy) throw busy;
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
