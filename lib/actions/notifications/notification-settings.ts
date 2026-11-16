'use server';

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { businesses, users } from '@/lib/db/schema';
import type { GstFilingFrequency, NotificationCategory } from '@/lib/db/domain-values';
import { isAppRole, type AppRole } from '@/lib/auth/rbac';
import { categoriesForRole } from '@/lib/notifications/catalog';
import { isGstFilingFrequency } from '@/lib/notifications/guards';
import { notificationPrefsSchema, resolveNotificationPrefs, type NotificationPrefs } from '@/lib/notifications/prefs';

export interface NotificationSettings {
  readonly prefs: NotificationPrefs;
  readonly role: AppRole;
  /** The e-mail switches this person can ever use (others never reach them). */
  readonly categories: NotificationCategory[];
  readonly email: string | null;
  readonly gst: {
    readonly frequency: GstFilingFrequency | null;
    readonly registrationType: 'regular' | 'composition';
  } | null;
}

/** Feature C: the signed-in person's own notification choices, plus the business's GST filing frequency. */
export const getNotificationSettings = createAuthenticatedAction(
  z.object({}).strict(),
  async (_input, context): Promise<NotificationSettings> => {
    const role: AppRole = isAppRole(context.appUser.role) ? context.appUser.role : 'staff';
    const [me] = await db
      .select({ prefs: users.notification_prefs, email: users.email })
      .from(users)
      .where(eq(users.id, context.appUser.id))
      .limit(1);
    let gst: NotificationSettings['gst'] = null;
    if (context.appUser.business_id) {
      const [business] = await db
        .select({ frequency: businesses.gst_filing_frequency, registrationType: businesses.registration_type })
        .from(businesses)
        .where(eq(businesses.id, context.appUser.business_id))
        .limit(1);
      if (business) {
        gst = {
          frequency: isGstFilingFrequency(business.frequency) ? business.frequency : null,
          registrationType: business.registrationType,
        };
      }
    }
    return {
      prefs: resolveNotificationPrefs(me?.prefs),
      role,
      categories: categoriesForRole(role),
      email: me?.email ?? null,
      gst,
    };
  },
  'get-notification-settings',
);

/** Feature C: save the signed-in person's OWN e-mail choices (never anyone else's). */
export const saveNotificationPreferences = createAuthenticatedAction(
  notificationPrefsSchema,
  async (input, context): Promise<{ prefs: NotificationPrefs }> => {
    const prefs = resolveNotificationPrefs(input);
    const [saved] = await db
      .update(users)
      .set({ notification_prefs: { email: { ...prefs.email }, digest: prefs.digest }, updated_at: new Date() })
      .where(eq(users.id, context.appUser.id))
      .returning({ id: users.id });
    if (!saved) {
      throw new ActionError('We could not find your account. Please sign in again.', { code: 'NO_APP_USER' });
    }
    revalidatePath('/settings');
    return { prefs };
  },
  'save-notification-preferences',
);
