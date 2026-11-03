'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { subscriptionRequests, users } from '@/lib/db/schema';
import { isPlatformAdmin } from '@/lib/auth/admin';
import { evaluateRoleAccess, OWNER_ONLY } from '@/lib/auth/rbac';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';

const getBusinessSubscriptionsSchema = z.object({
  business_id: z.string().uuid('Invalid business ID'),
});

export const getBusinessSubscriptions = createAuthenticatedAction(
  getBusinessSubscriptionsSchema,
  async (input, context) => {
    // 1. Authorize user by checking if platform admin or verifying user is business owner
    const isAdmin = await isPlatformAdmin();
    const isBusinessOwner =
      context.appUser.business_id === input.business_id &&
      evaluateRoleAccess(context.appUser.role, OWNER_ONLY).allowed;

    if (!isAdmin && !isBusinessOwner) {
      throw new ActionError('Unauthorized: Access denied.', {
        code: 'UNAUTHORIZED_ACCESS',
      });
    }

    // 2. Query all requests for the business
    const results = await db
      .select({
        id: subscriptionRequests.id,
        planName: subscriptionRequests.plan_name,
        billingCycle: subscriptionRequests.billing_cycle,
        amountPaise: subscriptionRequests.amount_paise,
        paymentMethod: subscriptionRequests.payment_method,
        paymentReference: subscriptionRequests.payment_reference,
        screenshotStorageKey: subscriptionRequests.screenshot_storage_key,
        status: subscriptionRequests.status,
        rejectReason: subscriptionRequests.reject_reason,
        approvedAt: subscriptionRequests.approved_at,
        createdAt: subscriptionRequests.created_at,
        userName: users.display_name,
      })
      .from(subscriptionRequests)
      .leftJoin(users, eq(subscriptionRequests.user_id, users.id))
      .where(eq(subscriptionRequests.business_id, input.business_id))
      .orderBy(desc(subscriptionRequests.created_at));

    return results;
  },
  'get-business-subscriptions'
);
