import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { creditNotes, invoices } from '@/lib/db/schema';
import type { DbExecutor } from '@/lib/actions/_shared/ownership';
import { logError } from '@/lib/actions/_shared/logger';
import { deleteFileFromStorage, getFileBuffer } from '@/lib/storage/idrive';

/**
 * Loads an authorised signature object from storage and converts it to a base64 Data URI.
 * Gracefully returns null on any error so rendering a document never fails due to a missing signature.
 * Only accepts storage keys starting with 'signatures/' and ending with '.png'.
 */
export async function loadSignatureDataUri(key: string): Promise<string | null> {
  try {
    if (!key.startsWith('signatures/') || !key.endsWith('.png')) {
      logError('signature', new Error('Invalid signature storage key: must start with signatures/ and end with .png'), { key });
      return null;
    }
    const buffer = await getFileBuffer(key);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (error: unknown) {
    logError('signature', error, { key });
    return null;
  }
}

/**
 * Checks if an authorised signature storage key is referenced in the immutable snapshot
 * of any finalized invoice or credit note belonging to the given business.
 */
export async function isSignatureKeyReferenced(
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
        eq(invoices.signature_storage_key_snapshot, key),
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
        eq(creditNotes.signature_storage_key_snapshot, key),
      ),
    )
    .limit(1);

  return Boolean(creditNoteRow);
}

/**
 * Deletes an authorised signature object from storage only if it is not referenced by any historical snapshot.
 * Never throws — catches errors and logs via logError.
 */
export async function deleteSignatureObjectIfUnreferenced(
  businessId: string,
  key: string,
): Promise<'deleted' | 'kept_referenced' | 'failed'> {
  try {
    const referenced = await isSignatureKeyReferenced(db, businessId, key);
    if (referenced) {
      return 'kept_referenced';
    }
    await deleteFileFromStorage(key);
    return 'deleted';
  } catch (error: unknown) {
    logError('signature', error, { businessId, key, action: 'deleteSignatureObjectIfUnreferenced' });
    return 'failed';
  }
}

