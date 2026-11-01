'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { writeAudit } from '@/lib/audit/log';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { db } from '@/lib/db/client';
import { businesses } from '@/lib/db/schema';
import { uploadFileToStorage, deleteFileFromStorage } from '@/lib/storage/idrive';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { canUploadBusinessLogo } from '@/lib/subscriptions/entitlements';
import {
  requireValidUpload,
  buildUploadKey,
  IMAGE_MIMES,
  maxBase64Chars,
} from '@/lib/security/upload';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const uploadLogoSchema = z.object({
  base64Data: z.string().min(1, 'Image data is required').max(maxBase64Chars(MAX_FILE_SIZE_BYTES)),
  // client hint, ignored; kept so the existing client call still validates
  mimeType: z.string().max(100).optional(),
  fileName: z.string().optional(),
});

export const uploadBusinessLogo = createAuthenticatedAction(
  uploadLogoSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('No business linked to your account. Please complete business setup first.', {
        code: 'NO_BUSINESS',
      });
    }

    const requestContext = await getAuditRequestContext();

    // 1. Check existing business and entitlement
    const existing = await db
      .select({
        logo_storage_key: businesses.logo_storage_key,
        subscription_plan: businesses.subscription_plan,
        subscription_status: businesses.subscription_status,
        trial_ends_at: businesses.trial_ends_at,
        subscription_ends_at: businesses.subscription_ends_at,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);

    if (existing.length === 0) {
      throw new ActionError('Business profile not found.', { code: 'NOT_FOUND' });
    }

    const logoCheck = canUploadBusinessLogo(existing[0]);
    if (!logoCheck.allowed) {
      throw new ActionError(logoCheck.reason || 'Custom logo branding is an Essentials Pro feature.', {
        code: logoCheck.code || 'LOGO_UPLOAD_LOCKED',
      });
    }

    const logo = requireValidUpload(input.base64Data, {
      maxBytes: MAX_FILE_SIZE_BYTES,
      allowed: IMAGE_MIMES,
    });
    const storageKey = buildUploadKey(`logos/${businessId}`, logo.ext);

    // 2. Upload to storage first (upload -> locked DB swap -> best-effort delete of previous)
    try {
      await uploadFileToStorage(storageKey, logo.buffer, logo.mime, {
        contentDisposition: 'attachment',
        cacheControl: 'public, max-age=3600',
      });
    } catch (uploadError) {
      console.error('Failed to upload logo to iDrive E2:', uploadError);
      throw new ActionError('Failed to upload image to cloud storage. Please check your storage configuration.', {
        code: 'STORAGE_UPLOAD_FAILED',
      });
    }

    // 3. Swap the key in ONE transaction that locks the business row and returns the previous key
    let previousKey: string | null = null;
    try {
      previousKey = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ key: businesses.logo_storage_key })
          .from(businesses)
          .where(eq(businesses.id, businessId))
          .for('update');
        if (!row) throw new ActionError('Business profile not found.', { code: 'NOT_FOUND' });

        await tx
          .update(businesses)
          .set({ logo_storage_key: storageKey, updated_at: new Date() })
          .where(eq(businesses.id, businessId));

        await writeAudit(tx, {
          businessId,
          actorUserId: context.appUser.id,
          entityType: 'business',
          entityId: businessId,
          action: 'logo_upload',
          requestContext,
          metadata: {
            logo_storage_key: storageKey,
            previous_logo_storage_key: row.key,
          },
        });

        return row.key;
      });
    } catch (dbError: unknown) {
      await deleteFileFromStorage(storageKey).catch(() => undefined); // do not orphan the new object
      if (dbError instanceof ActionError) throw dbError;
      console.error('Failed to update business logo in DB:', dbError);
      throw new ActionError('Failed to update business profile record.', { code: 'DB_UPDATE_FAILED' });
    }

    // 4. Only AFTER the swap succeeds, best-effort delete previousKey
    if (previousKey) {
      try {
        await deleteFileFromStorage(previousKey);
      } catch (delError: unknown) {
        console.warn('Failed to delete previous logo from storage:', delError);
      }
    }

    revalidatePath('/settings');
    revalidatePath('/invoices');
    revalidatePath('/dashboard');

    return {
      storageKey,
      logoUrl: `/api/business/${businessId}/logo?t=${Date.now()}`,
    };
  },
  'upload-business-logo',
  { rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'upload-logo' } }
);
