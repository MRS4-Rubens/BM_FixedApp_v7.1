'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { db } from '@/lib/db/client';
import { subscriptionRequests, businesses, users } from '@/lib/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isBillingCycle, isPaidPlanName } from '@/lib/subscriptions/billing-period';
import { computePlanPurchase, type PlanPurchaseKind } from '@/lib/subscriptions/plan-change';

/** Feature G: what approving this claim would do right now (an estimate: the approval recomputes it under lock). */
export interface PendingClaimPlanChange {
  readonly kind: PlanPurchaseKind;
  readonly fromPlan: string | null;
  readonly unusedDays: number;
  readonly creditedDays: number;
  /** ISO timestamp of the new expiry if approved now. */
  readonly endsAt: string;
}

export const getPendingRequests = createAuthenticatedAction(
  z.object({}),
  async () => {
    // Fetch pending requests
    const results = await db
      .select({
        id: subscriptionRequests.id,
        businessId: subscriptionRequests.business_id,
        businessName: businesses.legal_name,
        businessGstin: businesses.gstin,
        businessEmail: businesses.email,
        userId: subscriptionRequests.user_id,
        userName: users.display_name,
        planName: subscriptionRequests.plan_name,
        billingCycle: subscriptionRequests.billing_cycle,
        amountPaise: subscriptionRequests.amount_paise,
        paymentMethod: subscriptionRequests.payment_method,
        paymentReference: subscriptionRequests.payment_reference,
        paidToVpa: subscriptionRequests.paid_to_vpa,
        paidToAccount: subscriptionRequests.paid_to_account,
        paidToIfsc: subscriptionRequests.paid_to_bank_ifsc,
        hasScreenshot: sql<boolean>`${subscriptionRequests.screenshot_storage_key} IS NOT NULL`.mapWith(Boolean),
        status: subscriptionRequests.status,
        createdAt: subscriptionRequests.created_at,
        currentPlan: businesses.subscription_plan,
        currentStatus: businesses.subscription_status,
        currentEndsAt: businesses.subscription_ends_at,
      })
      .from(subscriptionRequests)
      .innerJoin(businesses, eq(subscriptionRequests.business_id, businesses.id))
      .innerJoin(users, eq(subscriptionRequests.user_id, users.id))
      .where(eq(subscriptionRequests.status, 'pending'))
      .orderBy(desc(subscriptionRequests.created_at));

    const now = new Date();
    return results.map(({ currentPlan, currentStatus, currentEndsAt, ...row }) => {
      let planChange: PendingClaimPlanChange | null = null;
      if (isPaidPlanName(row.planName) && isBillingCycle(row.billingCycle)) {
        const purchase = computePlanPurchase(
          { subscription_plan: currentPlan, subscription_status: currentStatus, subscription_ends_at: currentEndsAt },
          row.planName,
          row.billingCycle,
          now,
        );
        planChange = {
          kind: purchase.kind,
          fromPlan: purchase.fromPlan,
          unusedDays: purchase.unusedDays,
          creditedDays: purchase.creditedDays,
          endsAt: purchase.endsAt.toISOString(),
        };
      }
      return { ...row, currentPlan, planChange };
    });
  },
  'get-pending-requests',
  { requirePlatformAdmin: true }
);
