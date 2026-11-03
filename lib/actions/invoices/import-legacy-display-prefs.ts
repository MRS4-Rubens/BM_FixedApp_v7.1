'use server';

import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { OWNER_ONLY } from '@/lib/auth/rbac';
import { db } from '@/lib/db/client';
import { businesses } from '@/lib/db/schema';
import { invoiceDisplayPrefsSchema } from '@/lib/invoices/display-prefs';

export const importLegacyDisplayPrefs = createAuthenticatedAction(
  z.object({ display_prefs: invoiceDisplayPrefsSchema }),
  async (input, context): Promise<{ applied: boolean }> => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Please complete your business profile first.', { code: 'NO_BUSINESS' });
    }

    // One guarded statement: applies ONLY while the account has never saved prefs. Idempotent + race-safe.
    const rows = await db
      .update(businesses)
      .set({ invoice_display_prefs: input.display_prefs, updated_at: new Date() })
      .where(and(eq(businesses.id, businessId), sql`${businesses.invoice_display_prefs} = '{}'::jsonb`))
      .returning({ id: businesses.id });

    revalidatePath('/settings');
    return { applied: rows.length === 1 };
  },
  'import-legacy-display-prefs',
  { roles: OWNER_ONLY, requireActiveSubscription: true },
);

