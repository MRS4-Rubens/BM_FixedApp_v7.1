'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { OWNER_ONLY } from '@/lib/auth/rbac';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { toLoggableError, toThrowable } from '@/lib/actions/_shared/action-error-mapping';
import { writeAudit } from '@/lib/audit/log';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { db } from '@/lib/db/client';
import { setLocalLockTimeout, withTransactionRetry } from '@/lib/db/transaction';
import { businesses } from '@/lib/db/schema';
import { uploadFileToStorage, deleteFileFromStorage } from '@/lib/storage/idrive';
import { deleteLogoObjectIfUnreferenced } from '@/lib/storage/logo';
import { buildLogoUrl } from '@/lib/storage/logo-url';
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
      logError('upload-business-logo', toLoggableError(uploadError), { stage: 'storage-upload' });
      throw new ActionError('Failed to upload image to cloud storage. Please try again.', {
        code: 'STORAGE_UPLOAD_FAILED',
      });
    }

    // 3. Swap the key in ONE transaction that locks the business row and returns the previous key
    let previousKey: string | null = null;
    try {
      previousKey = await withTransactionRetry(() =>
        db.transaction(async (tx) => {
          await setLocalLockTimeout(tx);
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
        }),
      );
    } catch (dbError: unknown) {
      await deleteFileFromStorage(storageKey).catch((cleanupError: unknown) => {
        logError('upload-business-logo', toLoggableError(cleanupError), { stage: 'orphan-cleanup', storageKey });
      });
      if (dbError instanceof ActionError) throw dbError;
      throw toThrowable(dbError);
    }

    // 4. Only AFTER the swap succeeds, delete previousKey if unreferenced
    // The reference check must run AFTER commit so any finalize holding FOR SHARE on the business row has already committed its snapshot.
    if (previousKey !== null && previousKey !== storageKey) {
      await deleteLogoObjectIfUnreferenced(businessId, previousKey);
    }

    revalidatePath('/settings');
    revalidatePath('/invoices');
    revalidatePath('/dashboard');

    return {
      storageKey,
      logoUrl: buildLogoUrl(businessId, storageKey),
    };
  },
  'upload-business-logo',
  {
    roles: OWNER_ONLY,
    rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'upload-logo', outage: 'fail-closed' },
    requireActiveSubscription: true,
  }
);
