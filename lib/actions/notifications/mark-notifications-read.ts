'use server';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { db } from '@/lib/db/client';
import { notifications } from '@/lib/db/schema';
import { markNotificationsReadSchema } from '@/lib/validations/notifications';

/**
 * Feature C: mark some (or all) of the signed-in person's OWN notifications as read. Ids that are not theirs, or
 * belong to another business, simply match nothing (access level 'self': it can only ever touch the caller's rows).
 */
export const markNotificationsRead = createAuthenticatedAction(
  markNotificationsReadSchema,
  async (input, context): Promise<{ updated: number }> => {
    const businessId = context.appUser.business_id;
    if (!businessId) return { updated: 0 };
    const mine = and(
      eq(notifications.user_id, context.appUser.id),
      eq(notifications.business_id, businessId),
      isNull(notifications.read_at),
    );
    const updated = await db
      .update(notifications)
      .set({ read_at: new Date() })
      .where('ids' in input ? and(mine, inArray(notifications.id, input.ids)) : mine)
      .returning({ id: notifications.id });
    return { updated: updated.length };
  },
  'mark-notifications-read',
);
