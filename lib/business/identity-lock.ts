import { and, eq } from 'drizzle-orm';
import { invoices } from '@/lib/db/schema';
import type { db } from '@/lib/db/client';

export type InvoiceQueryExecutor = Pick<typeof db, 'select'>;

/** True when the business has at least one FINALIZED invoice (drafts never lock identity). */
export async function hasFinalizedInvoices(
  executor: InvoiceQueryExecutor,
  businessId: string,
): Promise<boolean> {
  const rows = await executor
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.business_id, businessId), eq(invoices.lifecycle_status, 'finalized')))
    .limit(1);
  return rows.length > 0;
}
