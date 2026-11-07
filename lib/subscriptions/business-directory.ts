import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { businesses, invoices, users } from '@/lib/db/schema';

/**
 * Platform-admin business directory rows with per-business invoice and user counts.
 *
 * NOT a server action and must never be exported from a 'use server' module: it has no authorization of its own.
 * Callers (lib/actions/subscriptions/get-all-businesses.ts) enforce `requirePlatformAdmin`.
 *
 * PERF-002: the counts come from pre-grouped derived tables joined by business id. The previous version used
 * correlated subqueries written as `${invoices.business_id} = ${businesses.id}` inside a raw `sql` template.
 * Drizzle renders column references in a select without the table name ("business_id" = "id"), so inside the
 * subquery both names resolved to the INNER table and every count was 0. Derived tables with explicit aliases
 * avoid that ambiguity and also replace one subquery per business with one grouped scan per table.
 */
export async function listBusinessesWithCounts() {
  const invoiceCounts = db
    .select({ businessId: invoices.business_id, count: sql<number>`count(*)::int`.as('invoice_count') })
    .from(invoices)
    .groupBy(invoices.business_id)
    .as('invoice_counts');

  const userCounts = db
    .select({ businessId: users.business_id, count: sql<number>`count(*)::int`.as('user_count') })
    .from(users)
    .groupBy(users.business_id)
    .as('user_counts');

  return db
    .select({
      id: businesses.id,
      legalName: businesses.legal_name,
      tradeName: businesses.trade_name,
      gstin: businesses.gstin,
      email: businesses.email,
      phone: businesses.phone,
      subscriptionPlan: businesses.subscription_plan,
      subscriptionStatus: businesses.subscription_status,
      subscriptionEndsAt: businesses.subscription_ends_at,
      activeUtrNo: businesses.active_utr_no,
      createdAt: businesses.created_at,
      invoiceCount: sql<number>`coalesce(${invoiceCounts.count}, 0)::int`,
      userCount: sql<number>`coalesce(${userCounts.count}, 0)::int`,
    })
    .from(businesses)
    .leftJoin(invoiceCounts, eq(invoiceCounts.businessId, businesses.id))
    .leftJoin(userCounts, eq(userCounts.businessId, businesses.id))
    .orderBy(desc(businesses.created_at));
}
