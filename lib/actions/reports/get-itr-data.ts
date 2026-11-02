'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { businesses, invoices, invoiceLineItems, payments, creditNotes, creditNoteLineItems } from '@/lib/db/schema';
import { eq, and, between, inArray, asc } from 'drizzle-orm';
import { exportRangeSchema } from '@/lib/validations/export';

export interface ItrInvoiceItem {
  id: string;
  invoice_number: string;
  invoice_date: string | null;
  customer_name: string | null;
  customer_gstin: string | null;
  rates: Record<number, number>; // rate percentage -> taxable_value_paise
  subtotal_paise: number;
  total_tax_paise: number;
  grand_total_paise: number;
  payment_status: string;
}

export interface ItrMonthlySummary {
  monthKey: string;
  monthLabel: string;
  quarterLabel: string;
  invoiceCount: number;
  rates: Record<number, number>; // rate percentage -> taxable_value_paise
  subtotal_paise: number;
  total_tax_paise: number;
  grand_total_paise: number;
}

export interface ItrExportData {
  business: {
    legal_name: string;
    trade_name: string | null;
    gstin: string;
    pan: string | null;
  };
  label: string;
  startDate: string;
  endDate: string;
  isAnnual: boolean;
  supportedRates: number[];
  invoices: ItrInvoiceItem[];
  rateTotals: Record<number, number>; // rate percentage -> total taxable_value_paise
  totalSalesTaxablePaise: number;
  totalTaxPaise: number;
  grandTotalSalesPaise: number;
  monthlySummary: ItrMonthlySummary[];
  turnover44Ad: {
    digitalReceiptsPaise: number;
    cashReceiptsPaise: number;
    unpaidReceivablesPaise: number;
    totalTurnoverPaise: number;
    presumptiveDigitalProfitPaise: number;
    presumptiveCashProfitPaise: number;
    totalPresumptiveProfitPaise: number;
  };
}

export const getItrExportData = createAuthenticatedAction(exportRangeSchema, async (input, context) => {
  const businessId = context.appUser.business_id;
  if (!businessId) {
    throw new ActionError('Your account is not linked to a business profile.', {
      code: 'NO_BUSINESS_LINKED',
    });
  }

  // 1. Fetch business details
  const [business] = await db
    .select({
      legal_name: businesses.legal_name,
      trade_name: businesses.trade_name,
      gstin: businesses.gstin,
      pan: businesses.pan,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId));

  if (!business) {
    throw new ActionError('Business profile not found.', {
      code: 'BUSINESS_NOT_FOUND',
    });
  }

  // 2. Fetch all finalized invoices in the date window
  const rawInvoices = await db
    .select({
      id: invoices.id,
      invoice_number: invoices.invoice_number,
      invoice_date: invoices.invoice_date,
      customer_name: invoices.billing_name_snapshot,
      customer_gstin: invoices.billing_gstin_snapshot,
      subtotal_paise: invoices.subtotal_paise,
      total_tax_paise: invoices.total_tax_paise,
      grand_total_paise: invoices.grand_total_paise,
      payment_status: invoices.payment_status
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.business_id, businessId),
        eq(invoices.lifecycle_status, 'finalized'),
        between(invoices.invoice_date, input.startDate, input.endDate)
      )
    )
    .orderBy(asc(invoices.invoice_date), asc(invoices.invoice_number));

  const invoiceIds = rawInvoices.map((inv) => inv.id);

  // 3. Fetch line items for these invoices
  const rawLineItems = invoiceIds.length > 0
    ? await db
        .select({
          invoice_id: invoiceLineItems.invoice_id,
          tax_rate_percentage: invoiceLineItems.tax_rate_percentage,
          taxable_value_paise: invoiceLineItems.taxable_value_paise,
          line_total_paise: invoiceLineItems.line_total_paise,
        })
        .from(invoiceLineItems)
        .where(inArray(invoiceLineItems.invoice_id, invoiceIds))
    : [];

  // 3b. Fetch active finalized credit notes & line items in the date window
  const rawCreditNotes = await db
    .select({
      id: creditNotes.id,
      original_invoice_id: creditNotes.original_invoice_id,
      issue_date: creditNotes.issue_date,
      subtotal_paise: creditNotes.subtotal_paise,
      total_tax_paise: creditNotes.total_tax_paise,
      grand_total_paise: creditNotes.grand_total_paise,
    })
    .from(creditNotes)
    .where(
      and(
        eq(creditNotes.business_id, businessId),
        eq(creditNotes.lifecycle_status, 'finalized'),
        eq(creditNotes.status, 'active'),
        between(creditNotes.issue_date, input.startDate, input.endDate)
      )
    );

  const cnIds = rawCreditNotes.map((cn) => cn.id);

  const rawCnLineItems = cnIds.length > 0
    ? await db
        .select({
          credit_note_id: creditNoteLineItems.credit_note_id,
          tax_rate_percentage: creditNoteLineItems.tax_rate_percentage,
          taxable_value_paise: creditNoteLineItems.taxable_value_paise,
        })
        .from(creditNoteLineItems)
        .where(inArray(creditNoteLineItems.credit_note_id, cnIds))
    : [];

  // Group line items by invoice_id and tax_rate_percentage
  const invoiceRateMap = new Map<string, Record<number, number>>();
  const allEncounteredRates = new Set<number>([0, 5, 12, 18, 28]); // Standard Indian GST rates

  for (const item of rawLineItems) {
    const rateNum = Number(item.tax_rate_percentage);
    allEncounteredRates.add(rateNum);

    if (!invoiceRateMap.has(item.invoice_id)) {
      invoiceRateMap.set(item.invoice_id, {});
    }
    const currentRates = invoiceRateMap.get(item.invoice_id)!;
    currentRates[rateNum] = (currentRates[rateNum] || 0) + item.taxable_value_paise;
  }

  const cnRateMap = new Map<string, Record<number, number>>();
  for (const cnItem of rawCnLineItems) {
    const rateNum = Number(cnItem.tax_rate_percentage);
    allEncounteredRates.add(rateNum);
    if (!cnRateMap.has(cnItem.credit_note_id)) {
      cnRateMap.set(cnItem.credit_note_id, {});
    }
    const currentRates = cnRateMap.get(cnItem.credit_note_id)!;
    currentRates[rateNum] = (currentRates[rateNum] || 0) + cnItem.taxable_value_paise;
  }

  const invoiceCnMap = new Map<string, { subtotalPaise: number; taxPaise: number; grandTotalPaise: number; rates: Record<number, number> }>();
  for (const cn of rawCreditNotes) {
    if (!invoiceCnMap.has(cn.original_invoice_id)) {
      invoiceCnMap.set(cn.original_invoice_id, { subtotalPaise: 0, taxPaise: 0, grandTotalPaise: 0, rates: {} });
    }
    const entry = invoiceCnMap.get(cn.original_invoice_id)!;
    entry.subtotalPaise += cn.subtotal_paise;
    entry.taxPaise += cn.total_tax_paise;
    entry.grandTotalPaise += cn.grand_total_paise;
    const rates = cnRateMap.get(cn.id);
    if (rates) {
      for (const [rStr, val] of Object.entries(rates)) {
        const r = Number(rStr);
        entry.rates[r] = (entry.rates[r] || 0) + val;
      }
    }
  }

  // Sort supported rates in ascending order
  const supportedRates = Array.from(allEncounteredRates).sort((a, b) => a - b);

  // 4. Fetch payments linked to these invoices for Section 44AD digital vs cash split (only active payments)
  const rawPayments = invoiceIds.length > 0
    ? await db
        .select({
          invoice_id: payments.invoice_id,
          amount_paise: payments.amount_paise,
          payment_method: payments.payment_method,
        })
        .from(payments)
        .where(
          and(
            inArray(payments.invoice_id, invoiceIds),
            eq(payments.status, 'active')
          )
        )
    : [];

  const invoicePaymentMap = new Map<string, { digitalPaise: number; cashPaise: number; totalPaidPaise: number }>();
  const digitalMethods = new Set(['upi', 'bank_transfer', 'cheque', 'card']);

  for (const pay of rawPayments) {
    if (!invoicePaymentMap.has(pay.invoice_id)) {
      invoicePaymentMap.set(pay.invoice_id, { digitalPaise: 0, cashPaise: 0, totalPaidPaise: 0 });
    }
    const rec = invoicePaymentMap.get(pay.invoice_id)!;
    rec.totalPaidPaise += pay.amount_paise;
    if (digitalMethods.has(pay.payment_method)) {
      rec.digitalPaise += pay.amount_paise;
    } else {
      rec.cashPaise += pay.amount_paise;
    }
  }

  // 5. Build invoice item records & aggregate rate totals
  // 5. Aggregate gross invoice amounts and credit note deductions
  let grossTaxablePaise = 0;
  let grossTaxPaise = 0;
  let grossGrandTotalPaise = 0;
  const grossRateTotals: Record<number, number> = {};
  for (const r of supportedRates) {
    grossRateTotals[r] = 0;
  }

  for (const inv of rawInvoices) {
    grossTaxablePaise += inv.subtotal_paise;
    grossTaxPaise += inv.total_tax_paise;
    grossGrandTotalPaise += inv.grand_total_paise;
  }

  for (const item of rawLineItems) {
    const rateNum = Number(item.tax_rate_percentage);
    grossRateTotals[rateNum] = (grossRateTotals[rateNum] || 0) + item.taxable_value_paise;
  }

  let totalCnTaxablePaise = 0;
  let totalCnTaxPaise = 0;
  let totalCnGrandTotalPaise = 0;
  const cnRateTotals: Record<number, number> = {};
  for (const r of supportedRates) {
    cnRateTotals[r] = 0;
  }

  for (const cn of rawCreditNotes) {
    totalCnTaxablePaise += cn.subtotal_paise;
    totalCnTaxPaise += cn.total_tax_paise;
    totalCnGrandTotalPaise += cn.grand_total_paise;
  }

  for (const cnItem of rawCnLineItems) {
    const rateNum = Number(cnItem.tax_rate_percentage);
    cnRateTotals[rateNum] = (cnRateTotals[rateNum] || 0) + cnItem.taxable_value_paise;
  }

  // 1. Overall summary totals (net of ALL active finalized credit notes in period)
  const totalSalesTaxablePaise = Math.max(0, grossTaxablePaise - totalCnTaxablePaise);
  const totalTaxPaise = Math.max(0, grossTaxPaise - totalCnTaxPaise);
  const grandTotalSalesPaise = Math.max(0, grossGrandTotalPaise - totalCnGrandTotalPaise);

  // 2. Rate-wise GST/turnover breakdown (net of ALL active finalized credit notes in period)
  const rateTotals: Record<number, number> = {};
  for (const r of supportedRates) {
    rateTotals[r] = Math.max(0, (grossRateTotals[r] || 0) - (cnRateTotals[r] || 0));
  }

  let totalDigitalReceiptsPaise = 0;
  let totalCashReceiptsPaise = 0;
  let totalUnpaidReceivablesPaise = 0;

  const invoiceItems: ItrInvoiceItem[] = rawInvoices.map((inv) => {
    const rates: Record<number, number> = {};
    for (const r of supportedRates) {
      rates[r] = 0;
    }

    const matchedRates = invoiceRateMap.get(inv.id);
    if (matchedRates) {
      for (const [rStr, val] of Object.entries(matchedRates)) {
        const r = Number(rStr);
        rates[r] = val;
      }
    } else {
      rates[0] = inv.subtotal_paise;
    }

    const cnForInv = invoiceCnMap.get(inv.id);
    const netSubtotal = Math.max(0, inv.subtotal_paise - (cnForInv?.subtotalPaise || 0));
    const netTax = Math.max(0, inv.total_tax_paise - (cnForInv?.taxPaise || 0));
    const netGrandTotal = Math.max(0, inv.grand_total_paise - (cnForInv?.grandTotalPaise || 0));

    if (cnForInv?.rates) {
      for (const [rStr, val] of Object.entries(cnForInv.rates)) {
        const r = Number(rStr);
        rates[r] = Math.max(0, (rates[r] || 0) - val);
      }
    }

    // 44AD tracking
    const payInfo = invoicePaymentMap.get(inv.id) || { digitalPaise: 0, cashPaise: 0, totalPaidPaise: 0 };
    totalDigitalReceiptsPaise += payInfo.digitalPaise;
    totalCashReceiptsPaise += payInfo.cashPaise;
    const unpaid = Math.max(0, netGrandTotal - payInfo.totalPaidPaise);
    totalUnpaidReceivablesPaise += unpaid;

    return {
      id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date,
      customer_name: inv.customer_name || 'Cash Customer',
      customer_gstin: inv.customer_gstin || 'Unregistered',
      rates,
      subtotal_paise: netSubtotal,
      total_tax_paise: netTax,
      grand_total_paise: netGrandTotal,
      payment_status: inv.payment_status
    };
  });

  // 6. Build Month-wise summary for ITR P&L Schedule
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthMap = new Map<string, ItrMonthlySummary>();

  const getOrCreateMonthEntry = (dateStr: string) => {
    const [yStr, mStr] = dateStr.split('-');
    const mNum = parseInt(mStr, 10);
    const key = `${yStr}-${mStr}`;
    const label = `${monthNames[mNum - 1]} ${yStr}`;

    // Indian Financial Quarters: Q1 (Apr-Jun), Q2 (Jul-Sep), Q3 (Oct-Dec), Q4 (Jan-Mar)
    let quarterLabel = 'Q1 (Apr-Jun)';
    if (mNum >= 7 && mNum <= 9) quarterLabel = 'Q2 (Jul-Sep)';
    else if (mNum >= 10 && mNum <= 12) quarterLabel = 'Q3 (Oct-Dec)';
    else if (mNum >= 1 && mNum <= 3) quarterLabel = 'Q4 (Jan-Mar)';

    if (!monthMap.has(key)) {
      const initialRates: Record<number, number> = {};
      for (const r of supportedRates) initialRates[r] = 0;
      monthMap.set(key, {
        monthKey: key,
        monthLabel: label,
        quarterLabel,
        invoiceCount: 0,
        rates: initialRates,
        subtotal_paise: 0,
        total_tax_paise: 0,
        grand_total_paise: 0
      });
    }
    return monthMap.get(key)!;
  };

  // Add invoices to their respective month bucket
  for (const inv of rawInvoices) {
    if (!inv.invoice_date) continue;
    const entry = getOrCreateMonthEntry(inv.invoice_date);
    entry.invoiceCount += 1;
    entry.subtotal_paise += inv.subtotal_paise;
    entry.total_tax_paise += inv.total_tax_paise;
    entry.grand_total_paise += inv.grand_total_paise;

    const matchedRates = invoiceRateMap.get(inv.id);
    if (matchedRates) {
      for (const [rStr, val] of Object.entries(matchedRates)) {
        const r = Number(rStr);
        entry.rates[r] = (entry.rates[r] || 0) + val;
      }
    } else {
      entry.rates[0] = (entry.rates[0] || 0) + inv.subtotal_paise;
    }
  }

  // Deduct active finalized credit notes from their respective issue_date month bucket
  for (const cn of rawCreditNotes) {
    if (!cn.issue_date) continue;
    const entry = getOrCreateMonthEntry(cn.issue_date);
    entry.subtotal_paise = Math.max(0, entry.subtotal_paise - cn.subtotal_paise);
    entry.total_tax_paise = Math.max(0, entry.total_tax_paise - cn.total_tax_paise);
    entry.grand_total_paise = Math.max(0, entry.grand_total_paise - cn.grand_total_paise);

    const rates = cnRateMap.get(cn.id);
    if (rates) {
      for (const [rStr, val] of Object.entries(rates)) {
        const r = Number(rStr);
        entry.rates[r] = Math.max(0, (entry.rates[r] || 0) - val);
      }
    }
  }

  const monthlySummary = Array.from(monthMap.values()).sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  // Determine if annual (e.g. difference between start and end > 100 days or label contains "FY")
  const isAnnual = input.label.toUpperCase().includes('FY') || monthlySummary.length > 2;

  // Presumptive calculation (Sec 44AD): 6% on digital turnover, 8% on cash/unpaid turnover
  const totalCollectionsPaise = totalDigitalReceiptsPaise + totalCashReceiptsPaise + totalUnpaidReceivablesPaise;
  const digitalFraction = totalCollectionsPaise > 0 ? (totalDigitalReceiptsPaise / totalCollectionsPaise) : 0;
  
  const digitalTurnoverTaxablePaise = Math.round(totalSalesTaxablePaise * digitalFraction);
  const cashTurnoverTaxablePaise = totalSalesTaxablePaise - digitalTurnoverTaxablePaise;

  const presumptiveDigitalProfitPaise = Math.round(digitalTurnoverTaxablePaise * 0.06);
  const presumptiveCashProfitPaise = Math.round(cashTurnoverTaxablePaise * 0.08);
  const totalPresumptiveProfitPaise = presumptiveDigitalProfitPaise + presumptiveCashProfitPaise;

  return {
    business: {
      legal_name: business.legal_name,
      trade_name: business.trade_name,
      gstin: business.gstin,
      pan: business.pan,
    },
    label: input.label,
    startDate: input.startDate,
    endDate: input.endDate,
    isAnnual,
    supportedRates,
    invoices: invoiceItems,
    rateTotals,
    totalSalesTaxablePaise,
    totalTaxPaise,
    grandTotalSalesPaise,
    monthlySummary,
    turnover44Ad: {
      digitalReceiptsPaise: totalDigitalReceiptsPaise,
      cashReceiptsPaise: totalCashReceiptsPaise,
      unpaidReceivablesPaise: totalUnpaidReceivablesPaise,
      totalTurnoverPaise: totalSalesTaxablePaise,
      presumptiveDigitalProfitPaise,
      presumptiveCashProfitPaise,
      totalPresumptiveProfitPaise
    }
  };
}, 'get-itr-data');
