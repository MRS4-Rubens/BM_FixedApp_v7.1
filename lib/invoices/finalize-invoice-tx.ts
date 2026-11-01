import { and, between, eq, gte, lte, sql } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import { findOwnedCustomer } from '@/lib/actions/_shared/ownership';
import type { DbTransaction } from '@/lib/db/client';
import { businesses, invoiceLineItems, invoices } from '@/lib/db/schema';
import { calculateInvoiceTaxOrActionError } from '@/lib/invoices/tax-calculation';
import type { TaxCalculationInput, TaxLineItemInput } from '@/lib/gst/types';
import { setLocalLockTimeout } from '@/lib/db/transaction';
import { lockDraftInvoice } from '@/lib/invoices/document-locks';
import { getIndianFinancialYearForDate } from '@/lib/invoices/financial-year';
import { getOrCreateCurrentFinancialYear } from '@/lib/invoices/financial-year-rollover';
import { evaluateInvoiceDate } from '@/lib/invoices/invoice-date-policy';
import { formatIstDateAsIso, getIstDateParts, parseIsoDateToIstDate } from '@/lib/invoices/ist-date';
import { getNextInvoiceNumber } from '@/lib/invoices/numbering';
import { captureSellerSnapshot } from '@/lib/invoices/seller-snapshot';
import { getCurrentMonthRange } from '@/lib/reports/period';
import { canCreateInvoice, canUseTemplate, getPlanEntitlements } from '@/lib/subscriptions/entitlements';

export interface FinalizeInvoiceTxParams {
  readonly invoiceId: string;
  readonly businessId: string;
  readonly confirmCrossFinancialYear?: boolean;
}

export interface FinalizeInvoiceTxResult {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
}

export async function finalizeDraftInvoiceInTransaction(
  tx: DbTransaction,
  params: FinalizeInvoiceTxParams,
): Promise<FinalizeInvoiceTxResult> {
  // 1. Fail-fast lock timeout
  await setLocalLockTimeout(tx);

  // 2. Lock draft invoice row FOR UPDATE and validate state
  const invoice = await lockDraftInvoice(tx, { id: params.invoiceId, businessId: params.businessId });

  // 3. Fetch Business and Customer
  const businessResult = await tx.select().from(businesses).where(eq(businesses.id, params.businessId));
  if (businessResult.length === 0) throw new ActionError('Business not found.', { code: 'NOT_FOUND' });
  const business = businessResult[0];

  // Entitlement Checks
  const entitlements = getPlanEntitlements(business);
  if (entitlements.isSuspended) {
    throw new ActionError('Your account has been suspended. Please contact platform support.', { code: 'ACCOUNT_SUSPENDED' });
  }

  const templateCheck = canUseTemplate(business, invoice.invoice_template || 'template_1');
  if (!templateCheck.allowed) {
    throw new ActionError(templateCheck.reason || 'Template requires Essentials Pro.', { code: 'TEMPLATE_LOCKED' });
  }

  const monthRange = getCurrentMonthRange();
  const finalizedCountRes = await tx
    .select({ count: sql<number>`count(*)` })
    .from(invoices)
    .where(
      and(
        eq(invoices.business_id, params.businessId),
        eq(invoices.lifecycle_status, 'finalized'),
        between(invoices.invoice_date, monthRange.startDate, monthRange.endDate)
      )
    );
  const finalizedThisMonth = Number(finalizedCountRes[0]?.count || 0);

  const quotaCheck = canCreateInvoice(business, finalizedThisMonth);
  if (!quotaCheck.allowed) {
    throw new ActionError(
      quotaCheck.reason || 'Monthly limit of 30 finalized invoices reached on the Free Plan. Please upgrade your subscription.',
      { code: quotaCheck.code || 'QUOTA_EXCEEDED' }
    );
  }

  if (business.registration_type === 'composition') {
    throw new ActionError('Composition-scheme invoicing (Bill of Supply) is not yet supported — this MVP handles Regular-scheme tax invoices only.', { code: 'NOT_SUPPORTED' });
  }

  const hasCustomer = !!invoice.customer_id;
  // Tenant isolation (API-001): only a customer of THIS business may be copied into the invoice snapshot.
  const customer = invoice.customer_id ? await findOwnedCustomer(tx, params.businessId, invoice.customer_id) : null;

  if (hasCustomer && !customer) throw new ActionError('Customer not found.', { code: 'NOT_FOUND' });
  const placeOfSupplyStateCode = customer ? customer.state_code : invoice.place_of_supply_state_code;

  // 4. Fetch Line Items and Tax Rates for authoritative recalc
  const lineItems = await tx.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoice_id, params.invoiceId)).orderBy(invoiceLineItems.sort_order);
  if (lineItems.length === 0) throw new ActionError('Cannot finalize an invoice with no line items.', { code: 'NO_ITEMS' });

  // Note: the draft might have stale tax rates if they changed, though our draft stores tax_rate_percentage
  // To strictly follow "recompute authoritatively", we just use the stored rate from line items or fetch from DB if we stored the relation.
  // Wait, invoice_line_items doesn't store tax_rate_id directly (schema only has tax_rate_percentage). 
  // But we just re-run calculateInvoiceTax with the percentages currently in line items to ensure mathematical consistency.
  const taxLineItemInputs: TaxLineItemInput[] = lineItems.map(li => ({
    quantity: Number(li.quantity),
    unitPricePaise: li.unit_price_paise,
    discountPaise: li.discount_paise,
    taxRatePercentage: Number(li.tax_rate_percentage)
  }));

  const taxCalcInput: TaxCalculationInput = {
    sellerStateCode: business.state_code,
    placeOfSupplyStateCode: placeOfSupplyStateCode || business.state_code,
    lineItems: taxLineItemInputs,
    // Authoritatively recalculate using the locked calculation mode of the invoice
    gstRateType: invoice.gst_rate_type
  };

  const taxResult = calculateInvoiceTaxOrActionError(taxCalcInput);

  // 5. Update Line Items if any rounding differences occurred (defense in depth)
  // Since it's finalized, we want to make absolutely sure line items match the calculation.
  for (let i = 0; i < lineItems.length; i++) {
    const li = lineItems[i];
    const calcLi = taxResult.lineItems[i];
    await tx.update(invoiceLineItems).set({
      taxable_value_paise: calcLi.taxableValuePaise,
      cgst_paise: calcLi.cgstPaise,
      sgst_paise: calcLi.sgstPaise,
      igst_paise: calcLi.igstPaise,
      line_total_paise: calcLi.lineTotalPaise
    }).where(eq(invoiceLineItems.id, li.id));
  }

  // 6. Date validation & FY resolution
  const todayIso = formatIstDateAsIso(new Date());
  const invoiceDateIso = invoice.invoice_date ?? todayIso;
  const invoiceDate = parseIsoDateToIstDate(invoiceDateIso);
  const seriesFy = getIndianFinancialYearForDate(invoiceDate);
  const [latestRow] = await tx
    .select({ latest: sql<string | null>`to_char(max(${invoices.invoice_date}), 'YYYY-MM-DD')` })
    .from(invoices)
    .where(and(
      eq(invoices.business_id, params.businessId),
      eq(invoices.lifecycle_status, 'finalized'),
      gte(invoices.invoice_date, formatIstDateAsIso(seriesFy.startDate)),
      lte(invoices.invoice_date, formatIstDateAsIso(seriesFy.endDate)),
    ));
  const dateDecision = evaluateInvoiceDate({
    invoiceDateIso,
    todayIso,
    latestFinalizedDateIso: latestRow?.latest ?? null,
    confirmCrossFinancialYear: params.confirmCrossFinancialYear === true,
  });
  if (!dateDecision.ok) throw new ActionError(dateDecision.message, { code: dateDecision.code });

  const fy = await getOrCreateCurrentFinancialYear(tx, params.businessId, invoiceDate);

  const { invoiceNumber, absoluteSequence } = await getNextInvoiceNumber(tx, {
    businessId: business.id,
    financialYearId: fy.id,
    fyLabel: fy.label,
    invoiceNumberFormat: business.invoice_number_format,
    invoiceDate
  });

  // 7. Snapshot fields
  let billingNameSnapshot = invoice.billing_name_snapshot;
  let billingGstinSnapshot = invoice.billing_gstin_snapshot;
  let billingAddressSnapshot = invoice.billing_address_snapshot;

  if (customer) {
    billingNameSnapshot = customer.name;
    billingGstinSnapshot = customer.gstin;
    const cityStatePincode = [customer.city, customer.state_code, customer.pincode].filter(Boolean).join(', ');
    billingAddressSnapshot = [
      customer.address_line1,
      customer.address_line2,
      cityStatePincode
    ].filter(Boolean).join('\n');
  }

  const { year, month, day } = getIstDateParts(invoiceDate);
  const dueIstDate = new Date(Date.UTC(year, month - 1, day + business.payment_due_days));
  const dueDateString = `${dueIstDate.getUTCFullYear()}-${String(dueIstDate.getUTCMonth() + 1).padStart(2, '0')}-${String(dueIstDate.getUTCDate()).padStart(2, '0')}`;

  // 8. Self-guarding update
  const updated = await tx
    .update(invoices)
    .set({
      invoice_sequence: absoluteSequence,
      invoice_number: invoiceNumber,
      financial_year_id: fy.id,
      lifecycle_status: 'finalized',
      invoice_date: invoiceDateIso,
      due_date: dueDateString,
      finalized_at: new Date(),
      place_of_supply_state_code: placeOfSupplyStateCode || business.state_code,
      seller_gstin_snapshot: business.gstin,
      ...captureSellerSnapshot(business),
      billing_name_snapshot: billingNameSnapshot,
      billing_gstin_snapshot: billingGstinSnapshot,
      billing_address_snapshot: billingAddressSnapshot,
      subtotal_paise: taxResult.subtotalPaise,
      total_cgst_paise: taxResult.totalCgstPaise,
      total_sgst_paise: taxResult.totalSgstPaise,
      total_igst_paise: taxResult.totalIgstPaise,
      total_tax_paise: taxResult.totalTaxPaise,
      grand_total_paise: Math.round(taxResult.grandTotalPaise / 100) * 100,
      // Confirm calculation mode is locked at finalization
      gst_rate_type: invoice.gst_rate_type,
    })
    .where(
      and(
        eq(invoices.id, params.invoiceId),
        eq(invoices.business_id, params.businessId),
        eq(invoices.lifecycle_status, 'draft'),
      ),
    )
    .returning({ id: invoices.id });

  if (updated.length !== 1) {
    // Unreachable while the row lock is held; defence in depth. Throwing rolls back the counter increments (no gap).
    throw new ActionError('This invoice has already been finalized.', { code: 'ALREADY_FINALIZED' });
  }

  return { invoiceId: params.invoiceId, invoiceNumber };
}

