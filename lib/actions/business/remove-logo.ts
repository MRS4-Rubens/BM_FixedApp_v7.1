'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { writeAudit } from '@/lib/audit/log';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { db } from '@/lib/db/client';
import { businesses } from '@/lib/db/schema';
import { deleteLogoObjectIfUnreferenced } from '@/lib/storage/logo';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

export const removeBusinessLogo = createAuthenticatedAction(
  z.object({}),
  async (_input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('No business linked to your account.', { code: 'NO_BUSINESS' });
    }

    const requestContext = await getAuditRequestContext();

    const existing = await db
      .select({ logo_storage_key: businesses.logo_storage_key })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);

    if (existing[0]?.logo_storage_key) {
      try {
        await deleteLogoObjectIfUnreferenced(businessId, existing[0].logo_storage_key);
      } catch (delError) {
        console.warn('Failed to delete logo from iDrive E2 storage:', delError);
      }
    }

    try {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ key: businesses.logo_storage_key })
          .from(businesses)
          .where(eq(businesses.id, businessId))
          .for('update');
        if (!row) throw new ActionError('Business profile not found.', { code: 'NOT_FOUND' });

        await tx
          .update(businesses)
          .set({
            logo_storage_key: null,
            updated_at: new Date(),
          })
          .where(eq(businesses.id, businessId));

        if (row.key !== null) {
          await writeAudit(tx, {
            businessId,
            actorUserId: context.appUser.id,
            entityType: 'business',
            entityId: businessId,
            action: 'logo_remove',
            requestContext,
            metadata: {
              previous_logo_storage_key: row.key,
            },
          });
        }
      });
    } catch (dbError) {
      if (dbError instanceof ActionError) throw dbError;
      console.error('Failed to clear business logo in DB:', dbError);
      throw new ActionError('Failed to remove logo record from database.', { code: 'DB_UPDATE_FAILED' });
    }

    revalidatePath('/settings');
    revalidatePath('/invoices');
    revalidatePath('/dashboard');

    return { success: true };
  },
  'remove-business-logo',
  { requireActiveSubscription: true }
);
