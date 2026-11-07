import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { creditNotes, invoices } from '@/lib/db/schema';
import type { DbExecutor } from '@/lib/actions/_shared/ownership';
import { logError } from '@/lib/actions/_shared/logger';
import { deleteFileFromStorage, getFileBuffer } from '@/lib/storage/idrive';
import { logoMimeFromKey } from '@/lib/storage/logo-url';

/**
 * Loads a logo object from storage and converts it to a base64 Data URI.
 * Gracefully returns null on any error so rendering a document never fails due to a missing logo.
 */
export async function loadLogoDataUri(key: string): Promise<string | null> {
  try {
    const mime = logoMimeFromKey(key);
    if (!mime) {
      logError('logo', new Error('Unsupported logo key extension'), { key });
      return null;
    }
    const buffer = await getFileBuffer(key);
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (error: unknown) {
    logError('logo', error, { key });
    return null;
  }
}

/**
 * Checks if a logo storage key is referenced in the immutable snapshot of any finalized
 * invoice or credit note belonging to the given business.
 */
export async function isLogoKeyReferenced(
  executor: DbExecutor,
  businessId: string,
  key: string,
): Promise<boolean> {
  const [invoiceRow] = await executor
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.business_id, businessId),
        eq(invoices.logo_storage_key_snapshot, key),
      ),
    )
    .limit(1);

  if (invoiceRow) {
    return true;
  }

  const [creditNoteRow] = await executor
    .select({ id: creditNotes.id })
    .from(creditNotes)
    .where(
      and(
        eq(creditNotes.business_id, businessId),
        eq(creditNotes.logo_storage_key_snapshot, key),
      ),
    )
    .limit(1);

  return Boolean(creditNoteRow);
}

/**
 * Deletes a logo object from storage only if it is not referenced by any historical snapshot.
 * Never throws — catches errors and logs via logError.
 */
export async function deleteLogoObjectIfUnreferenced(
  businessId: string,
  key: string,
): Promise<'deleted' | 'kept_referenced' | 'failed'> {
  try {
    const referenced = await isLogoKeyReferenced(db, businessId, key);
    if (referenced) {
      return 'kept_referenced';
    }
    await deleteFileFromStorage(key);
    return 'deleted';
  } catch (error: unknown) {
    logError('logo', error, { businessId, key, action: 'deleteLogoObjectIfUnreferenced' });
    return 'failed';
  }
}
