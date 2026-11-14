'use server';

import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { invoices } from '@/lib/db/schema/invoices';
import { creditNotes } from '@/lib/db/schema/credit_notes';
import { formatIstDateAsIso } from '@/lib/invoices/ist-date';
import {
  getCurrentMonthRange,
  getCurrentFinancialYearRange,
} from '@/lib/reports/period';

const getTodayIstIsoDate = () => formatIstDateAsIso(new Date());
const getCurrentMonthPeriod = () => getCurrentMonthRange();
const getCurrentFinancialYearPeriod = () => getCurrentFinancialYearRange();

export type DashboardStats = {
  revenueThisMonthPaise: number;
  revenueThisMonthLabel: string;
  revenueThisFyPaise: number;
  revenueThisFyLabel: string;
  totalInvoicesCount: number;
  totalFinalizedCount: number;
  draftInvoicesCount: number;
  draftCount: number;
  outstandingAmountPaise: number;
  outstandingTotalPaise: number;
  overdueCount: number;
  overdueAmountPaise: number;
  overdueTotalPaise: number;
};

const getDashboardStatsSchema = z.record(z.string(), z.unknown()).optional().default({});

export const getDashboardStats = createAuthenticatedAction(
  getDashboardStatsSchema,
  async (_input, context): Promise<DashboardStats> => {
    const appUser = context.appUser;
    const businessId = appUser.business_id;
    if (!businessId) {
      throw new ActionError('Your account is not linked to a business profile.', {
        code: 'NO_BUSINESS_LINKED',
      });
    }

    const todayIso = getTodayIstIsoDate();
    const currentMonth = getCurrentMonthPeriod();
    const currentFy = getCurrentFinancialYearPeriod();

    const [
      [monthInvRevRow],
      [monthCnRevRow],
      [fyInvRevRow],
      [fyCnRevRow],
      [countsRow],
      outstandingOverdueResult,
    ] = await Promise.all([
      // 1a. Revenue this month (finalized invoices)
      db
        .select({
          total: sql<number>`coalesce(sum(${invoices.grand_total_paise}), 0)::bigint`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.business_id, businessId),
            eq(invoices.lifecycle_status, 'finalized'),
            gte(invoices.invoice_date, currentMonth.startDate),
            lte(invoices.invoice_date, currentMonth.endDate)
          )
        ),

      // 1b. Credit notes this month (finalized & active)
      db
        .select({
          total: sql<number>`coalesce(sum(${creditNotes.grand_total_paise}), 0)::bigint`,
        })
        .from(creditNotes)
        .where(
          and(
            eq(creditNotes.business_id, businessId),
            eq(creditNotes.lifecycle_status, 'finalized'),
            eq(creditNotes.status, 'active'),
            gte(creditNotes.issue_date, currentMonth.startDate),
            lte(creditNotes.issue_date, currentMonth.endDate)
          )
        ),

      // 2a. Revenue this FY (finalized invoices)
      db
        .select({
          total: sql<number>`coalesce(sum(${invoices.grand_total_paise}), 0)::bigint`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.business_id, businessId),
            eq(invoices.lifecycle_status, 'finalized'),
            gte(invoices.invoice_date, currentFy.startDate),
            lte(invoices.invoice_date, currentFy.endDate)
          )
        ),

      // 2b. Credit notes this FY (finalized & active)
      db
        .select({
          total: sql<number>`coalesce(sum(${creditNotes.grand_total_paise}), 0)::bigint`,
        })
        .from(creditNotes)
        .where(
          and(
            eq(creditNotes.business_id, businessId),
            eq(creditNotes.lifecycle_status, 'finalized'),
            eq(creditNotes.status, 'active'),
            gte(creditNotes.issue_date, currentFy.startDate),
            lte(creditNotes.issue_date, currentFy.endDate)
          )
        ),

      // 3. Total finalized & draft invoice counts
      db
        .select({
          finalized_count: sql<number>`count(*) filter (where ${invoices.lifecycle_status} = 'finalized')::int`,
          draft_count: sql<number>`count(*) filter (where ${invoices.lifecycle_status} = 'draft')::int`,
        })
        .from(invoices)
        .where(eq(invoices.business_id, businessId)),

      // 4. One aggregate query using pre-grouped LEFT JOINs (PERF-002)
      db.execute<{
        outstanding: string | number;
        overdue_count: number;
        overdue_amount: string | number;
      }>(sql`
        SELECT
          coalesce(sum(t.remaining), 0)::bigint AS outstanding,
          count(*) filter (where t.is_overdue)::int AS overdue_count,
          coalesce(sum(t.remaining) filter (where t.is_overdue), 0)::bigint AS overdue_amount
        FROM (
          SELECT
            greatest(0, i.grand_total_paise - coalesce(p.paid, 0) - coalesce(c.credited, 0)) AS remaining,
            (i.payment_status = 'overdue' OR (i.due_date IS NOT NULL AND i.due_date < ${todayIso}::date)) AS is_overdue
          FROM invoices i
          LEFT JOIN (
            -- NET kept from the customer: refunds (kind = 'refund') count as money paid back.
            SELECT invoice_id, sum(CASE WHEN kind = 'refund' THEN -amount_paise ELSE amount_paise END) AS paid
            FROM payments
            WHERE business_id = ${businessId}
              AND status = 'active'
            GROUP BY invoice_id
          ) p ON p.invoice_id = i.id
          LEFT JOIN (
            SELECT original_invoice_id, sum(grand_total_paise) AS credited
            FROM credit_notes
            WHERE business_id = ${businessId}
              AND lifecycle_status = 'finalized'
              AND status = 'active'
            GROUP BY original_invoice_id
          ) c ON c.original_invoice_id = i.id
          WHERE i.business_id = ${businessId}
            AND i.lifecycle_status = 'finalized'
            AND i.payment_status IN ('unpaid', 'partially_paid', 'overdue')
        ) t
        WHERE t.remaining > 0
      `),
    ]);

    const statsRow = outstandingOverdueResult.rows[0];
    const outstandingAmountPaise = Number(statsRow?.outstanding ?? 0);
    const overdueCount = Number(statsRow?.overdue_count ?? 0);
    const overdueAmountPaise = Number(statsRow?.overdue_amount ?? 0);

    return {
      revenueThisMonthPaise:
        Number(monthInvRevRow?.total ?? 0) - Number(monthCnRevRow?.total ?? 0),
      revenueThisMonthLabel: currentMonth.label,
      revenueThisFyPaise:
        Number(fyInvRevRow?.total ?? 0) - Number(fyCnRevRow?.total ?? 0),
      revenueThisFyLabel: currentFy.label,
      totalInvoicesCount: Number(countsRow?.finalized_count ?? 0),
      totalFinalizedCount: Number(countsRow?.finalized_count ?? 0),
      draftInvoicesCount: Number(countsRow?.draft_count ?? 0),
      draftCount: Number(countsRow?.draft_count ?? 0),
      outstandingAmountPaise,
      outstandingTotalPaise: outstandingAmountPaise,
      overdueCount,
      overdueAmountPaise,
      overdueTotalPaise: overdueAmountPaise,
    };
  },
  'get-dashboard-stats'
);
