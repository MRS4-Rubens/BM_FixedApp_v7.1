'use server';

import { randomUUID } from 'node:crypto';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { writeAudit } from '@/lib/audit/log';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { db } from '@/lib/db/client';
import { businesses, subscriptionRequests, users } from '@/lib/db/schema';
import { requirePlatformAdmin } from '@/lib/auth/admin';
import { eq, and, asc } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  assertOverrideCoherent,
  OverrideRuleError,
  updateBusinessSubscriptionSchema,
} from '@/lib/validations/admin-subscription';

export const updateBusinessSubscription = createAuthenticatedAction(
  updateBusinessSubscriptionSchema,
  async (input, context) => {
    const adminEmail = (await requirePlatformAdmin()).email || context.appUser.email;

    const now = new Date();
    const endsAt = input.subscription_ends_at === null ? null : new Date(input.subscription_ends_at);
    try {
      assertOverrideCoherent({
        plan: input.subscription_plan,
        status: input.subscription_status,
        endsAt,
        now,
      });
    } catch (err: unknown) {
      if (err instanceof OverrideRuleError) throw new ActionError(err.message, { code: err.code });
      throw err;
    }

    try {
      const requestContext = await getAuditRequestContext();
      await db.transaction(async (tx) => {
        const [business] = await tx
          .select({
            id: businesses.id,
            subscription_plan: businesses.subscription_plan,
            subscription_status: businesses.subscription_status,
            subscription_ends_at: businesses.subscription_ends_at,
          })
          .from(businesses)
          .where(eq(businesses.id, input.business_id))
          .for('update');
        if (!business) throw new ActionError('Business not found.', { code: 'BUSINESS_NOT_FOUND' });

        // The ledger row belongs to the business, so it is attributed to its OWNER (earliest owner account), not to the acting admin.
        const [owner] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.business_id, business.id), eq(users.role, 'owner')))
          .orderBy(asc(users.created_at))
          .limit(1);
        if (!owner) {
          throw new ActionError('This business has no owner account to attach the ledger entry to.', {
            code: 'OWNER_NOT_FOUND',
          });
        }

        await tx
          .update(businesses)
          .set({
            subscription_plan: input.subscription_plan,
            subscription_status: input.subscription_status,
            subscription_ends_at: endsAt,
            trial_ends_at: input.subscription_plan === 'trial' ? endsAt : undefined,
            updated_at: now,
          })
          .where(eq(businesses.id, business.id));

        await writeAudit(tx, {
          businessId: business.id,
          actorUserId: context.appUser.id, // actor = the admin
          entityType: 'business',
          entityId: business.id,
          action: 'subscription_manual_override',
          requestContext,
          metadata: {
            updated_by: adminEmail,
            previous: {
              subscription_plan: business.subscription_plan,
              subscription_status: business.subscription_status,
              subscription_ends_at: business.subscription_ends_at
                ? new Date(business.subscription_ends_at).toISOString()
                : null,
            },
            subscription_plan: input.subscription_plan,
            subscription_status: input.subscription_status,
            subscription_ends_at: endsAt ? endsAt.toISOString() : null,
            overridden_at: now.toISOString(),
          },
        });

        await tx.insert(subscriptionRequests).values({
          business_id: business.id,
          user_id: owner.id,
          plan_name: input.subscription_plan,
          billing_cycle: 'manual_override',
          amount_paise: 0,
          payment_method: 'manual_override',
          payment_reference: `MANUAL-${randomUUID()}`,
          status: 'approved',
          reject_reason: `Manual Override by Platform Admin (${adminEmail})`,
          approved_at: now,
          subscription_ends_at: endsAt,
        });
      });
    } catch (err: unknown) {
      if (err instanceof ActionError) throw err;
      logError('update-business-subscription', err, { businessId: input.business_id });
      throw new ActionError('Failed to manually update business subscription.', {
        code: 'OVERRIDE_FAILED',
      });
    }

    // 2. Revalidate cache
    revalidatePath('/admin');
    revalidatePath('/checkout');
    revalidatePath('/dashboard');

    return {
      businessId: input.business_id,
      status: input.subscription_status,
    };
  },
  'update-business-subscription',
  { requirePlatformAdmin: true }
);
