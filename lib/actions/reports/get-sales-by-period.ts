'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { invoices, creditNotes } from '@/lib/db/schema';
import { eq, and, between, sql } from 'drizzle-orm';
import { paiseToRupees } from '@/lib/money';
import { z } from 'zod';
import { checkReportRange, reportRangeShape } from '@/lib/validations/report-range';

// BUG-02: real calendar dates and at most 366 days, so a bad URL can neither crash the query nor make the
// month/week/day bucket loops below run for thousands of iterations.
const getSalesByPeriodSchema = z
  .object({
    ...reportRangeShape,
    interval: z.enum(['auto', 'month', 'week']).optional(),
  })
  .superRefine(checkReportRange);

export type MonthlySalesData = {
  key: string;
  label: string;
  subtotal: number;
  total_cgst: number;
  total_sgst: number;
  total_igst: number;
  total_tax: number;
  grand_total: number;
  invoice_count: number;
};

interface IntervalBucket extends MonthlySalesData {
  startDateStr: string;
  endDateStr: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getDailyIntervalsInRange(start: string, end: string): IntervalBucket[] {
  const startD = new Date(start + 'T00:00:00Z');
  const endD = new Date(end + 'T00:00:00Z');
  const intervals: IntervalBucket[] = [];
  
  let cur = new Date(startD);
  while (cur <= endD) {
    const curStr = cur.toISOString().slice(0, 10);
    const day = cur.getUTCDate();
    const month = MONTH_NAMES[cur.getUTCMonth()];
    
    intervals.push({
      key: curStr,
      label: `${day} ${month}`,
      startDateStr: curStr,
      endDateStr: curStr,
      subtotal: 0,
      total_cgst: 0,
      total_sgst: 0,
      total_igst: 0,
      total_tax: 0,
      grand_total: 0,
      invoice_count: 0,
    });
    
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  
  return intervals;
}

function getWeeklyIntervalsInRange(start: string, end: string): IntervalBucket[] {
  const startD = new Date(start + 'T00:00:00Z');
  const endD = new Date(end + 'T00:00:00Z');
  const intervals: IntervalBucket[] = [];
  
  let cur = new Date(startD);
  let weekIndex = 1;
  
  while (cur <= endD) {
    const curEnd = new Date(Math.min(cur.getTime() + 6 * 24 * 60 * 60 * 1000, endD.getTime()));
    
    const curStartStr = cur.toISOString().slice(0, 10);
    const curEndStr = curEnd.toISOString().slice(0, 10);
    
    const startDay = cur.getUTCDate();
    const endDay = curEnd.getUTCDate();
    const startMonth = MONTH_NAMES[cur.getUTCMonth()];
    const endMonth = MONTH_NAMES[curEnd.getUTCMonth()];
    
    let label = '';
    if (startMonth === endMonth) {
      if (startDay === endDay) {
        label = `${startDay} ${startMonth}`;
      } else {
        label = `${startDay}–${endDay} ${startMonth}`;
      }
    } else {
      label = `${startDay} ${startMonth} – ${endDay} ${endMonth}`;
    }
    
    intervals.push({
      key: `W${weekIndex}_${curStartStr}`,
      label,
      startDateStr: curStartStr,
      endDateStr: curEndStr,
      subtotal: 0,
      total_cgst: 0,
      total_sgst: 0,
      total_igst: 0,
      total_tax: 0,
      grand_total: 0,
      invoice_count: 0,
    });
    
    weekIndex++;
    cur = new Date(curEnd.getTime() + 24 * 60 * 60 * 1000);
  }
  
  return intervals;
}

function getMonthsInRange(start: string, end: string): MonthlySalesData[] {
  const [startYear, startMonth] = start.split('-').map(Number);
  const [endYear, endMonth] = end.split('-').map(Number);
  
  const months: MonthlySalesData[] = [];
  let currentYear = startYear;
  let currentMonth = startMonth;
  
  while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonth)) {
    const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    months.push({
      key: monthStr,
      label: `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`,
      subtotal: 0,
      total_cgst: 0,
      total_sgst: 0,
      total_igst: 0,
      total_tax: 0,
      grand_total: 0,
      invoice_count: 0,
    });
    
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
  }
  return months;
}

export const getSalesByPeriod = createAuthenticatedAction(getSalesByPeriodSchema, async (input, context) => {
  const businessId = context.appUser.business_id;
  if (!businessId) {
    throw new ActionError('Your account is not linked to a business profile.', {
      code: 'NO_BUSINESS_LINKED',
    });
  }

  const startD = new Date(input.startDate + 'T00:00:00Z');
  const endD = new Date(input.endDate + 'T00:00:00Z');
  const diffDays = Math.round((endD.getTime() - startD.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const useSubMonthlyIntervals = input.interval === 'week' || (input.interval !== 'month' && diffDays <= 35);

  if (useSubMonthlyIntervals) {
    const dayKey = sql<string>`to_char(${invoices.invoice_date}, 'YYYY-MM-DD')`;
    const cnDayKey = sql<string>`to_char(${creditNotes.issue_date}, 'YYYY-MM-DD')`;

    const [results, cnResults] = await Promise.all([
      db.select({
        day: dayKey,
        subtotal: sql<number>`coalesce(sum(${invoices.subtotal_paise}), 0)::bigint`,
        total_cgst: sql<number>`coalesce(sum(${invoices.total_cgst_paise}), 0)::bigint`,
        total_sgst: sql<number>`coalesce(sum(${invoices.total_sgst_paise}), 0)::bigint`,
        total_igst: sql<number>`coalesce(sum(${invoices.total_igst_paise}), 0)::bigint`,
        total_tax: sql<number>`coalesce(sum(${invoices.total_tax_paise}), 0)::bigint`,
        grand_total: sql<number>`coalesce(sum(${invoices.grand_total_paise}), 0)::bigint`,
        invoice_count: sql<number>`count(*)`,
      })
      .from(invoices)
      .where(and(
        eq(invoices.business_id, businessId),
        eq(invoices.lifecycle_status, 'finalized'),
        between(invoices.invoice_date, input.startDate, input.endDate)
      ))
      .groupBy(dayKey)
      .orderBy(dayKey),

      db.select({
        day: cnDayKey,
        subtotal: sql<number>`coalesce(sum(${creditNotes.subtotal_paise}), 0)::bigint`,
        total_cgst: sql<number>`coalesce(sum(${creditNotes.total_cgst_paise}), 0)::bigint`,
        total_sgst: sql<number>`coalesce(sum(${creditNotes.total_sgst_paise}), 0)::bigint`,
        total_igst: sql<number>`coalesce(sum(${creditNotes.total_igst_paise}), 0)::bigint`,
        total_tax: sql<number>`coalesce(sum(${creditNotes.total_tax_paise}), 0)::bigint`,
        grand_total: sql<number>`coalesce(sum(${creditNotes.grand_total_paise}), 0)::bigint`,
      })
      .from(creditNotes)
      .where(and(
        eq(creditNotes.business_id, businessId),
        eq(creditNotes.lifecycle_status, 'finalized'),
        eq(creditNotes.status, 'active'),
        between(creditNotes.issue_date, input.startDate, input.endDate)
      ))
      .groupBy(cnDayKey)
      .orderBy(cnDayKey),
    ]);

    const intervalBuckets = diffDays <= 7
      ? getDailyIntervalsInRange(input.startDate, input.endDate)
      : getWeeklyIntervalsInRange(input.startDate, input.endDate);

    const bucketPaise = intervalBuckets.map(() => ({
      subtotal: 0,
      total_cgst: 0,
      total_sgst: 0,
      total_igst: 0,
      total_tax: 0,
      grand_total: 0,
      invoice_count: 0,
    }));

    for (const row of results) {
      const dayStr = row.day;
      if (!dayStr) continue;
      
      const bucketIndex = intervalBuckets.findIndex(
        (b) => dayStr >= b.startDateStr && dayStr <= b.endDateStr
      );
      
      if (bucketIndex !== -1) {
        bucketPaise[bucketIndex].subtotal += Number(row.subtotal || 0);
        bucketPaise[bucketIndex].total_cgst += Number(row.total_cgst || 0);
        bucketPaise[bucketIndex].total_sgst += Number(row.total_sgst || 0);
        bucketPaise[bucketIndex].total_igst += Number(row.total_igst || 0);
        bucketPaise[bucketIndex].total_tax += Number(row.total_tax || 0);
        bucketPaise[bucketIndex].grand_total += Number(row.grand_total || 0);
        bucketPaise[bucketIndex].invoice_count += Number(row.invoice_count || 0);
      }
    }

    for (const cnRow of cnResults) {
      const dayStr = cnRow.day;
      if (!dayStr) continue;

      const bucketIndex = intervalBuckets.findIndex(
        (b) => dayStr >= b.startDateStr && dayStr <= b.endDateStr
      );

      if (bucketIndex !== -1) {
        bucketPaise[bucketIndex].subtotal -= Number(cnRow.subtotal || 0);
        bucketPaise[bucketIndex].total_cgst -= Number(cnRow.total_cgst || 0);
        bucketPaise[bucketIndex].total_sgst -= Number(cnRow.total_sgst || 0);
        bucketPaise[bucketIndex].total_igst -= Number(cnRow.total_igst || 0);
        bucketPaise[bucketIndex].total_tax -= Number(cnRow.total_tax || 0);
        bucketPaise[bucketIndex].grand_total -= Number(cnRow.grand_total || 0);
      }
    }

    return intervalBuckets.map((bucket, idx) => ({
      key: bucket.key,
      label: bucket.label,
      subtotal: paiseToRupees(bucketPaise[idx].subtotal),
      total_cgst: paiseToRupees(bucketPaise[idx].total_cgst),
      total_sgst: paiseToRupees(bucketPaise[idx].total_sgst),
      total_igst: paiseToRupees(bucketPaise[idx].total_igst),
      total_tax: paiseToRupees(bucketPaise[idx].total_tax),
      grand_total: paiseToRupees(bucketPaise[idx].grand_total),
      invoice_count: bucketPaise[idx].invoice_count,
    }));
  }

  // Monthly Rollup (for ranges > 35 days, such as FY or Multi-Month reports)
  const monthKey = sql<string>`to_char(${invoices.invoice_date}, 'YYYY-MM')`;
  const cnMonthKey = sql<string>`to_char(${creditNotes.issue_date}, 'YYYY-MM')`;

  const [results, cnResults] = await Promise.all([
    db.select({
      month: monthKey,
      subtotal: sql<number>`coalesce(sum(${invoices.subtotal_paise}), 0)::bigint`,
      total_cgst: sql<number>`coalesce(sum(${invoices.total_cgst_paise}), 0)::bigint`,
      total_sgst: sql<number>`coalesce(sum(${invoices.total_sgst_paise}), 0)::bigint`,
      total_igst: sql<number>`coalesce(sum(${invoices.total_igst_paise}), 0)::bigint`,
      total_tax: sql<number>`coalesce(sum(${invoices.total_tax_paise}), 0)::bigint`,
      grand_total: sql<number>`coalesce(sum(${invoices.grand_total_paise}), 0)::bigint`,
      invoice_count: sql<number>`count(*)`,
    })
    .from(invoices)
    .where(and(
      eq(invoices.business_id, businessId),
      eq(invoices.lifecycle_status, 'finalized'),
      between(invoices.invoice_date, input.startDate, input.endDate)
    ))
    .groupBy(monthKey)
    .orderBy(monthKey),

    db.select({
      month: cnMonthKey,
      subtotal: sql<number>`coalesce(sum(${creditNotes.subtotal_paise}), 0)::bigint`,
      total_cgst: sql<number>`coalesce(sum(${creditNotes.total_cgst_paise}), 0)::bigint`,
      total_sgst: sql<number>`coalesce(sum(${creditNotes.total_sgst_paise}), 0)::bigint`,
      total_igst: sql<number>`coalesce(sum(${creditNotes.total_igst_paise}), 0)::bigint`,
      total_tax: sql<number>`coalesce(sum(${creditNotes.total_tax_paise}), 0)::bigint`,
      grand_total: sql<number>`coalesce(sum(${creditNotes.grand_total_paise}), 0)::bigint`,
    })
    .from(creditNotes)
    .where(and(
      eq(creditNotes.business_id, businessId),
      eq(creditNotes.lifecycle_status, 'finalized'),
      eq(creditNotes.status, 'active'),
      between(creditNotes.issue_date, input.startDate, input.endDate)
    ))
    .groupBy(cnMonthKey)
    .orderBy(cnMonthKey),
  ]);

  const monthlyData = getMonthsInRange(input.startDate, input.endDate);
  const dataMap = new Map(monthlyData.map((m) => [m.key, {
    bucket: m,
    subtotalPaise: 0,
    totalCgstPaise: 0,
    totalSgstPaise: 0,
    totalIgstPaise: 0,
    totalTaxPaise: 0,
    grandTotalPaise: 0,
    invoiceCount: 0,
  }]));

  for (const row of results) {
    const entry = dataMap.get(row.month);
    if (entry) {
      entry.subtotalPaise += Number(row.subtotal || 0);
      entry.totalCgstPaise += Number(row.total_cgst || 0);
      entry.totalSgstPaise += Number(row.total_sgst || 0);
      entry.totalIgstPaise += Number(row.total_igst || 0);
      entry.totalTaxPaise += Number(row.total_tax || 0);
      entry.grandTotalPaise += Number(row.grand_total || 0);
      entry.invoiceCount += Number(row.invoice_count || 0);
    }
  }

  for (const cnRow of cnResults) {
    const entry = dataMap.get(cnRow.month);
    if (entry) {
      entry.subtotalPaise -= Number(cnRow.subtotal || 0);
      entry.totalCgstPaise -= Number(cnRow.total_cgst || 0);
      entry.totalSgstPaise -= Number(cnRow.total_sgst || 0);
      entry.totalIgstPaise -= Number(cnRow.total_igst || 0);
      entry.totalTaxPaise -= Number(cnRow.total_tax || 0);
      entry.grandTotalPaise -= Number(cnRow.grand_total || 0);
    }
  }

  for (const entry of dataMap.values()) {
    entry.bucket.subtotal = paiseToRupees(entry.subtotalPaise);
    entry.bucket.total_cgst = paiseToRupees(entry.totalCgstPaise);
    entry.bucket.total_sgst = paiseToRupees(entry.totalSgstPaise);
    entry.bucket.total_igst = paiseToRupees(entry.totalIgstPaise);
    entry.bucket.total_tax = paiseToRupees(entry.totalTaxPaise);
    entry.bucket.grand_total = paiseToRupees(entry.grandTotalPaise);
    entry.bucket.invoice_count = entry.invoiceCount;
  }

  return monthlyData;
}, 'get-sales-by-period');
