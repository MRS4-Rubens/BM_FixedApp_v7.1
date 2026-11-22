import { and, between, eq, sql } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import type { db, DbTransaction } from '@/lib/db/client';
import { invoices } from '@/lib/db/schema';
import { getMonthRangeForIsoDate } from '@/lib/reports/period';
import {
  canCreateInvoice,
  getPlanEntitlements,
  type BusinessSubscriptionSource,
} from '@/lib/subscriptions/entitlements';

function toCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Unexpected aggregate value while counting invoices.');
  }
  return parsed;
}

/**
 * Finalized invoices of the business with invoice_date in [startDate, endDate] (IST calendar dates). Drafts never count.
 * The ONE definition of "invoices used" for the monthly quota: the finalize check below and the Settings usage meter
 * both use it, so the meter can never show a different number from the limit that is enforced (MONEY-06).
 */
export async function countFinalizedInvoicesInRange(
  executor: typeof db | DbTransaction,
  businessId: string,
  range: { readonly startDate: string; readonly endDate: string },
): Promise<number> {
  const { startDate, endDate } = range;
  const [row] = await executor
    .select({ total: sql<string | number>`count(*)` })
    .from(invoices)
    .where(
      and(
        eq(invoices.business_id, businessId),
        eq(invoices.lifecycle_status, 'finalized'),
        between(invoices.invoice_date, startDate, endDate),
      ),
    );
  return toCount(row?.total);
}

/** Finalized invoices in the IST month containing `invoiceDateIso`. */
function countFinalizedInvoicesInMonthOf(tx: DbTransaction, businessId: string, invoiceDateIso: string): Promise<number> {
  return countFinalizedInvoicesInRange(tx, businessId, getMonthRangeForIsoDate(invoiceDateIso));
}

/**
 * PRECONDITION: the caller already holds the business row lock (lockBusinessRow) so the count cannot change concurrently,
 * and passes the LOCKED business row. Throws INVOICE_QUOTA_EXCEEDED / ACCOUNT_SUSPENDED.
 */
export async function assertInvoiceQuotaAvailable(
  tx: DbTransaction,
  args: { readonly businessId: string; readonly business: BusinessSubscriptionSource; readonly invoiceDateIso: string },
): Promise<void> {
  if (getPlanEntitlements(args.business).invoiceMonthlyLimit === null) {
    return; // unlimited plan: skip the count query
  }
  const finalizedInMonth = await countFinalizedInvoicesInMonthOf(tx, args.businessId, args.invoiceDateIso);
  const check = canCreateInvoice(args.business, finalizedInMonth);
  if (!check.allowed) {
    throw new ActionError(check.reason ?? 'Monthly invoice limit reached. Please upgrade your subscription.', {
      code: check.code ?? 'INVOICE_QUOTA_EXCEEDED',
    });
  }
}

