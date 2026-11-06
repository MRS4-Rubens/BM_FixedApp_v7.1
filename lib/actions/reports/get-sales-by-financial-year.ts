'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { invoices, financialYears, creditNotes } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { paiseToRupees } from '@/lib/money';
import { isCurrentFinancialYearLabel } from '@/lib/invoices/financial-year';
import { z } from 'zod';

export type FinancialYearSalesData = {
  key: string;
  label: string;
  subtotal: number;
  total_cgst: number;
  total_sgst: number;
  total_igst: number;
  total_tax: number;
  grand_total: number;
  invoice_count: number;
  is_current: boolean;
};

export const getSalesByFinancialYear = createAuthenticatedAction(
  z.object({}),
  async (_, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Your account is not linked to a business profile.', {
        code: 'NO_BUSINESS_LINKED',
      });
    }

    const [rows, cnRows] = await Promise.all([
      db
        .select({
          id: financialYears.id,
          label: financialYears.label,
          startDate: financialYears.start_date,
          endDate: financialYears.end_date,
          subtotal: sql<number>`coalesce(sum(${invoices.subtotal_paise}), 0)::bigint`,
          total_cgst: sql<number>`coalesce(sum(${invoices.total_cgst_paise}), 0)::bigint`,
          total_sgst: sql<number>`coalesce(sum(${invoices.total_sgst_paise}), 0)::bigint`,
          total_igst: sql<number>`coalesce(sum(${invoices.total_igst_paise}), 0)::bigint`,
          total_tax: sql<number>`coalesce(sum(${invoices.total_tax_paise}), 0)::bigint`,
          grand_total: sql<number>`coalesce(sum(${invoices.grand_total_paise}), 0)::bigint`,
          invoice_count: sql<number>`count(${invoices.id})`,
        })
        .from(financialYears)
        .leftJoin(
          invoices,
          and(
            eq(invoices.financial_year_id, financialYears.id),
            eq(invoices.lifecycle_status, 'finalized')
          )
        )
        .where(eq(financialYears.business_id, businessId))
        .groupBy(
          financialYears.id,
          financialYears.label,
          financialYears.start_date,
          financialYears.end_date
        )
        .orderBy(financialYears.start_date),

      db
        .select({
          financial_year_id: creditNotes.financial_year_id,
          subtotal: sql<number>`coalesce(sum(${creditNotes.subtotal_paise}), 0)::bigint`,
          total_cgst: sql<number>`coalesce(sum(${creditNotes.total_cgst_paise}), 0)::bigint`,
          total_sgst: sql<number>`coalesce(sum(${creditNotes.total_sgst_paise}), 0)::bigint`,
          total_igst: sql<number>`coalesce(sum(${creditNotes.total_igst_paise}), 0)::bigint`,
          total_tax: sql<number>`coalesce(sum(${creditNotes.total_tax_paise}), 0)::bigint`,
          grand_total: sql<number>`coalesce(sum(${creditNotes.grand_total_paise}), 0)::bigint`,
        })
        .from(creditNotes)
        .where(
          and(
            eq(creditNotes.business_id, businessId),
            eq(creditNotes.lifecycle_status, 'finalized'),
            eq(creditNotes.status, 'active')
          )
        )
        .groupBy(creditNotes.financial_year_id),
    ]);

    const cnMap = new Map(cnRows.map((cn) => [cn.financial_year_id, cn]));
    const now = new Date();

    return rows.map((r) => {
      const cn = cnMap.get(r.id);
      const subtotalPaise = Number(r.subtotal || 0) - Number(cn?.subtotal || 0);
      const totalCgstPaise = Number(r.total_cgst || 0) - Number(cn?.total_cgst || 0);
      const totalSgstPaise = Number(r.total_sgst || 0) - Number(cn?.total_sgst || 0);
      const totalIgstPaise = Number(r.total_igst || 0) - Number(cn?.total_igst || 0);
      const totalTaxPaise = Number(r.total_tax || 0) - Number(cn?.total_tax || 0);
      const grandTotalPaise = Number(r.grand_total || 0) - Number(cn?.grand_total || 0);

      return {
        key: r.label,
        label: r.label.startsWith('FY') ? r.label : `FY ${r.label}`,
        subtotal: paiseToRupees(subtotalPaise),
        total_cgst: paiseToRupees(totalCgstPaise),
        total_sgst: paiseToRupees(totalSgstPaise),
        total_igst: paiseToRupees(totalIgstPaise),
        total_tax: paiseToRupees(totalTaxPaise),
        grand_total: paiseToRupees(grandTotalPaise),
        invoice_count: Number(r.invoice_count || 0),
        is_current: isCurrentFinancialYearLabel(r.label, now),
      };
    });
  },
  'get-sales-by-financial-year'
);
