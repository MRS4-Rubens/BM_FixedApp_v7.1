'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { writeAudit } from '@/lib/audit/log';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { OWNER_ONLY } from '@/lib/auth/rbac';
import { db } from '@/lib/db/client';
import { businesses } from '@/lib/db/schema';
import type { GstFilingFrequency } from '@/lib/db/domain-values';
import { gstFilingFrequencySchema } from '@/lib/validations/notifications';

/**
 * Feature C: the owner tells us how often the business files GSTR-1/3B, which drives the GST deadline reminders.
 * A business setting, so owner-only and audited (previous and new value).
 */
export const saveGstFilingFrequency = createAuthenticatedAction(
  gstFilingFrequencySchema,
  async (input, context): Promise<{ frequency: GstFilingFrequency }> => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Set up your business profile first.', { code: 'NO_BUSINESS' });
    }
    const requestContext = await getAuditRequestContext();

    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ frequency: businesses.gst_filing_frequency })
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .for('update');
      if (!current) {
        throw new ActionError('Business not found.', { code: 'NOT_FOUND' });
      }
      if (current.frequency === input.frequency) return;
      await tx
        .update(businesses)
        .set({ gst_filing_frequency: input.frequency, updated_at: new Date() })
        .where(eq(businesses.id, businessId));
      await writeAudit(tx, {
        businessId,
        actorUserId: context.appUser.id,
        entityType: 'business',
        entityId: businessId,
        action: 'gst_filing_frequency_change',
        requestContext,
        metadata: { previous: current.frequency, new: input.frequency },
      });
    });

    revalidatePath('/settings');
    return { frequency: input.frequency };
  },
  'save-gst-filing-frequency',
  { roles: OWNER_ONLY },
);
