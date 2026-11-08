import { getCurrentAppUser } from '@/lib/auth/session';
import { getCurrentBusiness } from '@/lib/auth/current-business';
import { db } from '@/lib/db/client';
import { subscriptionRequests, users, invoices, customers, products } from '@/lib/db/schema';
import { eq, and, desc, sql, between } from 'drizzle-orm';
import { SettingsClient } from '@/components/app/settings/settings-client';
import { redirect } from 'next/navigation';
import { getCurrentMonthRange } from '@/lib/reports/period';
import { hasFinalizedInvoices } from '@/lib/business/identity-lock';
import { getCurrentFinancialYearLabel } from '@/lib/invoices/financial-year';
import { getRequestTimeMs } from '@/lib/time/request-time';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const appUser = await getCurrentAppUser();
  if (!appUser) {
    redirect('/login');
  }

  const resolvedParams = searchParams ? await searchParams : undefined;
  const initialTab = resolvedParams?.tab;

  let business = null;
  let subscriptionHistory: Array<{
    id: string;
    planName: string;
    billingCycle: string;
    amountPaise: number;
    paymentMethod: string;
    paymentReference: string;
    hasScreenshot: boolean;
    status: string;
    rejectReason: string | null;
    approvedAt: Date | null;
    createdAt: Date;
    userName: string | null;
  }> = [];

  const usageStats = {
    invoicesThisMonth: 0,
    invoicesTotal: 0,
    teamMembersCount: 1,
    customersCount: 0,
    productsCount: 0,
    currentMonthLabel: '',
  };

  if (appUser.business_id) {
    business = await getCurrentBusiness();

    if (business) {
      const monthRange = getCurrentMonthRange();
      usageStats.currentMonthLabel = monthRange.label;

      const [
        historyRows,
        invoicesMonthRes,
        invoicesTotalRes,
        teamMembersRes,
        customersRes,
        productsRes,
      ] = await Promise.all([
        db
          .select({
            id: subscriptionRequests.id,
            planName: subscriptionRequests.plan_name,
            billingCycle: subscriptionRequests.billing_cycle,
            amountPaise: subscriptionRequests.amount_paise,
            paymentMethod: subscriptionRequests.payment_method,
            paymentReference: subscriptionRequests.payment_reference,
            hasScreenshot: sql<boolean>`${subscriptionRequests.screenshot_storage_key} IS NOT NULL`.mapWith(Boolean),
            status: subscriptionRequests.status,
            rejectReason: subscriptionRequests.reject_reason,
            approvedAt: subscriptionRequests.approved_at,
            createdAt: subscriptionRequests.created_at,
            userName: users.display_name,
          })
          .from(subscriptionRequests)
          .leftJoin(users, eq(subscriptionRequests.user_id, users.id))
          .where(eq(subscriptionRequests.business_id, business.id))
          .orderBy(desc(subscriptionRequests.created_at)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(invoices)
          .where(
            and(
              eq(invoices.business_id, business.id),
              between(invoices.invoice_date, monthRange.startDate, monthRange.endDate)
            )
          ),
        db
          .select({ count: sql<number>`count(*)` })
          .from(invoices)
          .where(eq(invoices.business_id, business.id)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(eq(users.business_id, business.id)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(customers)
          .where(eq(customers.business_id, business.id)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(products)
          .where(eq(products.business_id, business.id)),
      ]);

      subscriptionHistory = historyRows;

      usageStats.invoicesThisMonth = Number(invoicesMonthRes[0]?.count || 0);
      usageStats.invoicesTotal = Number(invoicesTotalRes[0]?.count || 0);
      usageStats.teamMembersCount = Math.max(1, Number(teamMembersRes[0]?.count || 0));
      usageStats.customersCount = Number(customersRes[0]?.count || 0);
      usageStats.productsCount = Number(productsRes[0]?.count || 0);
    }
  }

  const identityLocked = business ? await hasFinalizedInvoices(db, business.id) : false;
  const currentFyLabel = getCurrentFinancialYearLabel();
  const nowMs = getRequestTimeMs();

  return (
    <SettingsClient
      business={business}
      currentFyLabel={currentFyLabel}
      initialTab={initialTab}
      initialSubscriptions={subscriptionHistory}
      usageStats={usageStats}
      identityLocked={identityLocked}
      nowMs={nowMs}
    />
  );
}
