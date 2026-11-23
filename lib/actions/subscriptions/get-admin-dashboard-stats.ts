'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { db } from '@/lib/db/client';
import { subscriptionRequests, businesses, invoices } from '@/lib/db/schema';
import { and, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { PAID_PLAN_NAMES } from '@/lib/db/domain-values';
import { z } from 'zod';
import { getIstDateParts } from '@/lib/invoices/ist-date';

export const getAdminDashboardStats = createAuthenticatedAction(
  z.object({}),
  async () => {
    // 1. Query aggregate stats
    const totalBusinessesResult = await db.select({ count: sql<number>`count(*)` }).from(businesses);
    // BR-01: "active subscriptions" = PAYING businesses now: status active, a paid plan, and an end date that has not
    // passed (or none). A Free business can carry status 'active', and a lapsed paid plan stays 'active' until the
    // daily job expires it; neither is a paying customer.
    const activeSubsResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(businesses)
      .where(
        and(
          eq(businesses.subscription_status, 'active'),
          inArray(businesses.subscription_plan, [...PAID_PLAN_NAMES]),
          or(isNull(businesses.subscription_ends_at), gt(businesses.subscription_ends_at, new Date())),
        ),
      );

    const totalRevenueResult = await db
      .select({ total: sql<number>`coalesce(sum(${subscriptionRequests.amount_paise}), 0)` })
      .from(subscriptionRequests)
      .where(eq(subscriptionRequests.status, 'approved'));

    const pendingRequestsResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(subscriptionRequests)
      .where(eq(subscriptionRequests.status, 'pending'));

    const platformInvoicesResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(invoices);

    // 2. Query plan distribution
    const planDistributionResult = await db
      .select({
        plan: businesses.subscription_plan,
        count: sql<number>`count(*)`,
      })
      .from(businesses)
      .groupBy(businesses.subscription_plan);

    const planMap: Record<string, number> = {
      trial: 0,
      free: 0,
      essentials: 0,
      professional: 0,
    };

    for (const row of planDistributionResult) {
      if (row.plan) {
        planMap[row.plan.toLowerCase()] = Number(row.count || 0);
      }
    }

    // 3. Monthly revenue trend for the last 6 calendar months
    const monthlyRevenueRows = await db
      .select({
        // BUG-03: months in India time (the database session runs in UTC).
        monthSort: sql<string>`to_char(${subscriptionRequests.created_at} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')`,
        revenuePaise: sql<number>`coalesce(sum(${subscriptionRequests.amount_paise}), 0)`,
        claimCount: sql<number>`count(*)`,
      })
      .from(subscriptionRequests)
      // BR-01: a manual plan override is saved as a ₹0 'approved' row; it is not a payment claim, so it must not
      // raise the monthly claim count (its ₹0 never changed the revenue).
      .where(and(eq(subscriptionRequests.status, 'approved'), ne(subscriptionRequests.payment_method, 'manual_override')))
      .groupBy(sql`to_char(${subscriptionRequests.created_at} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')`);

    const revenueByMonthSort = new Map<string, { revenuePaise: number; claimCount: number }>();
    for (const row of monthlyRevenueRows) {
      revenueByMonthSort.set(row.monthSort, {
        revenuePaise: Number(row.revenuePaise || 0),
        claimCount: Number(row.claimCount || 0),
      });
    }

    const { year: nowYear, month: nowMonth } = getIstDateParts(new Date());
    const last6Months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(nowYear, nowMonth - 1 - i, 1));
      const monthLabel = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      const monthSort = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const match = revenueByMonthSort.get(monthSort);

      last6Months.push({
        month: `${monthLabel} ${d.getUTCFullYear() % 100}`,
        revenuePaise: match ? match.revenuePaise : 0,
        claimCount: match ? match.claimCount : 0,
      });
    }

    return {
      totalBusinesses: Number(totalBusinessesResult[0]?.count || 0),
      activeSubscriptions: Number(activeSubsResult[0]?.count || 0),
      totalRevenuePaise: Number(totalRevenueResult[0]?.total || 0),
      pendingRequestsCount: Number(pendingRequestsResult[0]?.count || 0),
      platformInvoiceCount: Number(platformInvoicesResult[0]?.count || 0),
      planDistribution: planMap,
      monthlyRevenue: last6Months,
    };
  },
  'get-admin-dashboard-stats',
  { requirePlatformAdmin: true }
);
