import { eq } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import type { DbTransaction } from '@/lib/db/client';
import { businesses } from '@/lib/db/schema';

export type BusinessRow = typeof businesses.$inferSelect;

/**
 * Locks the business row FOR NO KEY UPDATE (API-010) so entitlement/quota checks and the writes they guard are serialized per business.
 * LOCK ORDER: invoice -> credit note -> payment -> BUSINESS -> financial_years -> invoice_number_counters.
 * NO KEY UPDATE (not UPDATE) so FK key-share checks from payment/customer/invoice inserts are never blocked.
 * Must be called inside a transaction, after setLocalLockTimeout(tx).
 */
export async function lockBusinessRow(tx: DbTransaction, businessId: string): Promise<BusinessRow> {
  const rows = await tx.select().from(businesses).where(eq(businesses.id, businessId)).for('no key update');
  const row = rows[0];
  if (row === undefined) {
    throw new ActionError('Business not found.', { code: 'NOT_FOUND' });
  }
  return row;
}

