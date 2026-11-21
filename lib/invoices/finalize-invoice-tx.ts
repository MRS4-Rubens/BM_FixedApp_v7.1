import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import { findOwnedCustomer } from '@/lib/actions/_shared/ownership';
import { writeAudit, type AuditRequestContext } from '@/lib/audit/log';
import { roundToRupeePaise } from '@/lib/money';
import type { DbTransaction } from '@/lib/db/client';
import { lockBusinessRow } from '@/lib/actions/_shared/business-lock';
import { invoiceLineItems, invoices } from '@/lib/db/schema';
import { assertDraftTotalsMatch, resolveDraftPlaceOfSupply } from '@/lib/invoices/place-of-supply';
import { calculateInvoiceTaxOrActionError } from '@/lib/invoices/tax-calculation';
import type { TaxCalculationInput, TaxLineItemInput } from '@/lib/gst/types';
import { setLocalLockTimeout } from '@/lib/db/transaction';
import { lockDraftInvoice } from '@/lib/invoices/document-locks';
import { getIndianFinancialYearForDate } from '@/lib/invoices/financial-year';
import { getOrCreateCurrentFinancialYear } from '@/lib/invoices/financial-year-rollover';
import { evaluateInvoiceDate } from '@/lib/invoices/invoice-date-policy';
import { assertInvoiceQuotaAvailable } from '@/lib/invoices/invoice-quota';
import { formatIstDateAsIso, getIstDateParts, parseIsoDateToIstDate } from '@/lib/invoices/ist-date';
import { getNextInvoiceNumber } from '@/lib/invoices/numbering';
import { resolveBuyerSnapshot } from '@/lib/invoices/buyer-snapshot';
import { captureSellerSnapshot } from '@/lib/invoices/seller-snapshot';
import { captureDisplayPrefsSnapshot, parseStoredDisplayPrefs } from '@/lib/invoices/display-prefs';
import { quantityFormatViolation } from '@/lib/invoices/quantity-format';
import { canUseTemplate, getPlanEntitlements } from '@/lib/subscriptions/entitlements';

export interface FinalizeInvoiceTxParams {
  readonly invoiceId: string;
  readonly businessId: string;
  readonly actorUserId: string | null;
  readonly requestContext: AuditRequestContext;
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

  // 3. Lock the business row FOR NO KEY UPDATE (lock order: invoice -> business -> financial_years -> counters).
  //    API-010: the lock is exclusive among finalizers, so the monthly quota count below is serialized. A FOR SHARE
  //    lock would let concurrent finalizers all read the same count and overshoot the plan limit.
  //    AUTH-004 / COMP-001: it also conflicts with profile, identity and logo edits (FOR UPDATE), so the seller
  //    snapshot can never capture a GSTIN, state or logo key that is being changed concurrently.
  const business = await lockBusinessRow(tx, params.businessId);

  // Entitlement Checks
  const entitlements = getPlanEntitlements(business);
  if (entitlements.isSuspended) {
    throw new ActionError('Your account has been suspended. Please contact platform support.', { code: 'ACCOUNT_SUSPENDED' });
  }

  const templateCheck = canUseTemplate(business, invoice.invoice_template || 'template_1');
  if (!templateCheck.allowed) {
    throw new ActionError(templateCheck.reason || 'Template requires Essentials Pro.', { code: 'TEMPLATE_LOCKED' });
  }

  if (business.registration_type === 'composition') {
    throw new ActionError('Composition-scheme invoicing (Bill of Supply) is not yet supported — this MVP handles Regular-scheme tax invoices only.', { code: 'NOT_SUPPORTED' });
  }

  const hasCustomer = !!invoice.customer_id;
  // Tenant isolation (API-001): only a customer of THIS business may be copied into the invoice snapshot.
  const customer = invoice.customer_id ? await findOwnedCustomer(tx, params.businessId, invoice.customer_id) : null;

  if (hasCustomer && !customer) throw new ActionError('Customer not found.', { code: 'NOT_FOUND' });

  // COMP-003: the user's explicit Place of Supply on the draft is authoritative. The customer's registered state is a
  // UI default only; it must never silently change the tax head here.
  const placeOfSupplyStateCode = resolveDraftPlaceOfSupply(invoice.place_of_supply_state_code);

  // 4. Fetch Line Items and Tax Rates for authoritative recalc
  const lineItems = await tx.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoice_id, params.invoiceId)).orderBy(invoiceLineItems.sort_order);
  if (lineItems.length === 0) throw new ActionError('Cannot finalize an invoice with no line items.', { code: 'NO_ITEMS' });

  // Quantity Format (Invoice Settings): a draft saved before the setting changed may hold more decimals than now
  // allowed. Drafts tolerate it; the issued invoice must not.
  const quantityDecimals = parseStoredDisplayPrefs(business.invoice_display_prefs).quantityDecimals;
  const quantityProblem = quantityFormatViolation(lineItems.map((li) => ({ quantity: li.quantity, decimals: quantityDecimals })));
  if (quantityProblem) throw new ActionError(quantityProblem, { code: 'QUANTITY_FORMAT' });

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
    placeOfSupplyStateCode: placeOfSupplyStateCode,
    lineItems: taxLineItemInputs,
    // Authoritatively recalculate using the locked calculation mode of the invoice
    gstRateType: invoice.gst_rate_type
  };

  const taxResult = calculateInvoiceTaxOrActionError(taxCalcInput);

  // COMP-003: the totals the user approved on the draft must equal the authoritative recalculation, otherwise abort
  // with nothing written (no line-item rewrite, no number consumed) instead of silently changing the invoice.
  assertDraftTotalsMatch(invoice, taxResult);

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

  // Quota (API-010): finalized invoices in the IST month of THIS invoice's date, under the business lock.
  // Throwing here rolls back everything (no sequence is consumed, no gap).
  await assertInvoiceQuotaAvailable(tx, { businessId: params.businessId, business, invoiceDateIso });

  const fy = await getOrCreateCurrentFinancialYear(tx, params.businessId, invoiceDate);

  const { invoiceNumber, absoluteSequence } = await getNextInvoiceNumber(tx, {
    businessId: business.id,
    financialYearId: fy.id,
    fyLabel: fy.label,
    invoiceNumberFormat: business.invoice_number_format,
    invoiceDate
  });

  // 7. Buyer snapshot (MONEY-02): the draft's GSTIN is what the user saw on the preview and is authoritative; a linked
  //    customer supplies the name and address. Never silently swap in the customer record's GSTIN.
  const buyer = resolveBuyerSnapshot(invoice, customer);
  const billingNameSnapshot = buyer.billingName;
  const billingGstinSnapshot = buyer.billingGstin;
  const billingAddressSnapshot = buyer.billingAddress;

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
      place_of_supply_state_code: placeOfSupplyStateCode,
      seller_gstin_snapshot: business.gstin,
      ...captureSellerSnapshot(business),
      display_prefs_snapshot: captureDisplayPrefsSnapshot(business.invoice_display_prefs),
      billing_name_snapshot: billingNameSnapshot,
      billing_gstin_snapshot: billingGstinSnapshot,
      billing_address_snapshot: billingAddressSnapshot,
      subtotal_paise: taxResult.subtotalPaise,
      total_cgst_paise: taxResult.totalCgstPaise,
      total_sgst_paise: taxResult.totalSgstPaise,
      total_igst_paise: taxResult.totalIgstPaise,
      total_tax_paise: taxResult.totalTaxPaise,
      grand_total_paise: roundToRupeePaise(taxResult.grandTotalPaise),
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
    .returning({
      id: invoices.id,
      invoice_number: invoices.invoice_number,
      invoice_sequence: invoices.invoice_sequence,
      invoice_date: invoices.invoice_date,
      financial_year_id: invoices.financial_year_id,
      place_of_supply_state_code: invoices.place_of_supply_state_code,
      subtotal_paise: invoices.subtotal_paise,
      total_tax_paise: invoices.total_tax_paise,
      grand_total_paise: invoices.grand_total_paise,
    });

  if (updated.length !== 1) {
    // Unreachable while the row lock is held; defence in depth. Throwing rolls back the counter increments (no gap).
    throw new ActionError('This invoice has already been finalized.', { code: 'ALREADY_FINALIZED' });
  }

  const [finalized] = updated;
  if (!finalized) {
    throw new ActionError('This invoice has already been finalized.', { code: 'ALREADY_FINALIZED' });
  }

  await writeAudit(tx, {
    businessId: params.businessId,
    actorUserId: params.actorUserId,
    entityType: 'invoice',
    entityId: finalized.id,
    action: 'finalize',
    requestContext: params.requestContext,
    metadata: {
      invoice_number: finalized.invoice_number,
      invoice_sequence: finalized.invoice_sequence,
      invoice_date: finalized.invoice_date,
      financial_year_id: finalized.financial_year_id,
      place_of_supply_state_code: finalized.place_of_supply_state_code,
      subtotal_paise: finalized.subtotal_paise,
      total_tax_paise: finalized.total_tax_paise,
      grand_total_paise: finalized.grand_total_paise,
      cross_financial_year_confirmed: params.confirmCrossFinancialYear === true,
    },
  });

  return { invoiceId: params.invoiceId, invoiceNumber };
}
