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
import { deleteSignatureObjectIfUnreferenced } from '@/lib/storage/signature';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireValidUpload, buildUploadKey } from '@/lib/security/upload';
import { maxBase64Chars } from '@/lib/security/upload-limits';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { SIGNATURE_MAX_BYTES, validateSignaturePng } from '@/lib/security/signature-image';

const uploadSignatureSchema = z.object({
  base64Data: z.string().min(1, 'Image data is required').max(maxBase64Chars(SIGNATURE_MAX_BYTES)),
});

export const uploadBusinessSignature = createAuthenticatedAction(
  uploadSignatureSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('No business linked to your account. Please complete business setup first.', {
        code: 'NO_BUSINESS',
      });
    }

    const requestContext = await getAuditRequestContext();

    // 1. Validate upload magic bytes (PNG only) and authorised signature constraints
    const upload = requireValidUpload(input.base64Data, {
      maxBytes: SIGNATURE_MAX_BYTES,
      allowed: ['image/png'],
    });

    const validation = validateSignaturePng(upload.buffer);
    if (!validation.ok) {
      throw new ActionError(validation.message, {
        code: 'INVALID_SIGNATURE_IMAGE',
        fieldErrors: { signature: [validation.message] },
      });
    }

    const storageKey = buildUploadKey(`signatures/${businessId}`, 'png');

    // 2. Upload to storage (upload -> locked DB swap -> best-effort delete of previous)
    try {
      await uploadFileToStorage(storageKey, upload.buffer, 'image/png', {
        contentDisposition: 'attachment',
        cacheControl: 'private, no-store',
      });
    } catch (uploadError) {
      logError('upload-business-signature', toLoggableError(uploadError), { stage: 'storage-upload' });
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
            .select({ key: businesses.signature_storage_key })
            .from(businesses)
            .where(eq(businesses.id, businessId))
            .for('update');
          if (!row) throw new ActionError('Business profile not found.', { code: 'NOT_FOUND' });

          await tx
            .update(businesses)
            .set({ signature_storage_key: storageKey, updated_at: new Date() })
            .where(eq(businesses.id, businessId));

          await writeAudit(tx, {
            businessId,
            actorUserId: context.appUser.id,
            entityType: 'business',
            entityId: businessId,
            action: 'signature_upload',
            requestContext,
            metadata: {
              signature_storage_key: storageKey,
              previous_signature_storage_key: row.key,
            },
          });

          return row.key;
        }),
      );
    } catch (dbError: unknown) {
      await deleteFileFromStorage(storageKey).catch((cleanupError: unknown) => {
        logError('upload-business-signature', toLoggableError(cleanupError), { stage: 'orphan-cleanup', storageKey });
      });
      if (dbError instanceof ActionError) throw dbError;
      throw toThrowable(dbError);
    }

    // 4. Only AFTER the swap succeeds, delete previousKey if unreferenced
    if (previousKey !== null && previousKey !== storageKey) {
      await deleteSignatureObjectIfUnreferenced(businessId, previousKey);
    }

    revalidatePath('/settings');
    revalidatePath('/invoices');
    revalidatePath('/credit-notes');

    return {
      hasSignature: true,
    };
  },
  'upload-business-signature',
  {
    roles: OWNER_ONLY,
    rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'upload-signature', outage: 'fail-closed' },
    requireActiveSubscription: true,
  },
);

