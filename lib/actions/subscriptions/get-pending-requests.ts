'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { db } from '@/lib/db/client';
import { subscriptionRequests, businesses, users } from '@/lib/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { z } from 'zod';

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
        hasScreenshot: sql<boolean>`${subscriptionRequests.screenshot_storage_key} IS NOT NULL`.mapWith(Boolean),
        status: subscriptionRequests.status,
        createdAt: subscriptionRequests.created_at,
      })
      .from(subscriptionRequests)
      .innerJoin(businesses, eq(subscriptionRequests.business_id, businesses.id))
      .innerJoin(users, eq(subscriptionRequests.user_id, users.id))
      .where(eq(subscriptionRequests.status, 'pending'))
      .orderBy(desc(subscriptionRequests.created_at));

    return results;
  },
  'get-pending-requests',
  { requirePlatformAdmin: true }
);
