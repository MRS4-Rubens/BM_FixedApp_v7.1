'use server';

import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
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
      unpaidInvoices,
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

      // 4. Unpaid / partially_paid / overdue finalized invoices with active payments & active finalized credit notes
      db
        .select({
          id: invoices.id,
          grand_total_paise: invoices.grand_total_paise,
          due_date: invoices.due_date,
          payment_status: invoices.payment_status,
          paid_paise: sql<number>`coalesce((
            select sum(p.amount_paise)
            from payments p
            where p.invoice_id = ${invoices.id}
              and p.status = 'active'
          ), 0)::bigint`,
          credited_paise: sql<number>`coalesce((
            select sum(cn.grand_total_paise)
            from credit_notes cn
            where cn.original_invoice_id = ${invoices.id}
              and cn.lifecycle_status = 'finalized'
              and cn.status = 'active'
          ), 0)::bigint`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.business_id, businessId),
            eq(invoices.lifecycle_status, 'finalized'),
            inArray(invoices.payment_status, ['unpaid', 'partially_paid', 'overdue'])
          )
        ),
    ]);

    let outstandingAmountPaise = 0;
    let overdueCount = 0;
    let overdueAmountPaise = 0;

    for (const inv of unpaidInvoices) {
      const remainingPaise = Math.max(
        0,
        Number(inv.grand_total_paise) -
          Number(inv.paid_paise) -
          Number(inv.credited_paise)
      );

      if (remainingPaise <= 0) continue;

      outstandingAmountPaise += remainingPaise;

      const isOverdue =
        inv.payment_status === 'overdue' ||
        (inv.due_date !== null && inv.due_date < todayIso);

      if (isOverdue) {
        overdueCount += 1;
        overdueAmountPaise += remainingPaise;
      }
    }

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
