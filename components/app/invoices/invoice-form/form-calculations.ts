import { calculateInvoiceTax } from '@/lib/gst/calculate';
import type {
  TaxCalculationInput,
  TaxCalculationResult,
  TaxLineItemInput,
  TaxLineItemResult,
} from '@/lib/gst/types';
import { buildPreviewTaxLineInput } from '@/lib/invoices/line-math';
import { roundToRupeePaise } from '@/lib/money';
import { parseIsoDateToIstDate } from '@/lib/invoices/ist-date';
import { getIndianFinancialYearForDate } from '@/lib/invoices/financial-year';
import { resolveInvoiceNumber } from '@/lib/invoices/number-format';
import type { FieldErrors } from 'react-hook-form';
import type { InvoiceDraftInput, InvoiceLineItemInput } from '@/lib/validations/invoice';
import type { CustomerOption } from '@/lib/pickers/types';
import type { CurrentBusiness } from '@/lib/auth/current-business';
import type { taxRates as taxRatesTable, financialYears as financialYearsTable } from '@/lib/db/schema';

export interface GstRateRow {
  ratePercentage: number;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

export function formatINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function computeInvoiceTaxPreview({
  lineItems,
  taxRates,
  sellerStateCode,
  placeOfSupplyStateCode,
  gstRateType = 'exclusive',
}: {
  lineItems: Array<{
    quantity?: number;
    unit_price?: number;
    discount?: number;
    tax_rate_id?: string | null;
  }>;
  taxRates: Array<typeof taxRatesTable.$inferSelect>;
  sellerStateCode: string;
  placeOfSupplyStateCode?: string;
  gstRateType?: 'exclusive' | 'inclusive';
}): {
  taxResult: TaxCalculationResult | null;
  supplyType: 'intra_state' | 'inter_state';
  totalTaxable: number;
  totalCGST: number;
  totalSGST: number;
  totalIGST: number;
  roundOff: number;
  grandTotal: number;
  gstBreakdownMap: Record<number, GstRateRow>;
  sortedGstRates: number[];
} {
  const sortedTaxRates = [...taxRates].sort((a, b) => Number(a.rate_percentage) - Number(b.rate_percentage));

  let taxResult: TaxCalculationResult | null = null;
  if (lineItems && lineItems.length > 0) {
    try {
      const taxLineItemInputs: TaxLineItemInput[] = lineItems
        .map((li) => {
          const ratePct = taxRates.find((tr) => tr.id === li.tax_rate_id)?.rate_percentage || 0;
          return buildPreviewTaxLineInput({
            quantity: li.quantity,
            unitPriceRupees: li.unit_price,
            discountPercent: li.discount,
            taxRatePercentage: Number(ratePct),
          });
        })
        .filter((li): li is TaxLineItemInput => li !== null);

      if (taxLineItemInputs.length > 0) {
        const taxCalcInput: TaxCalculationInput = {
          sellerStateCode,
          placeOfSupplyStateCode: placeOfSupplyStateCode || sellerStateCode,
          lineItems: taxLineItemInputs,
          gstRateType,
        };
        taxResult = calculateInvoiceTax(taxCalcInput);
      }
    } catch {
      // Ignore intermediate calculation errors during typing
    }
  }

  const supplyType = taxResult ? taxResult.supplyType : 'intra_state';
  const totalTaxable = taxResult ? taxResult.subtotalPaise / 100 : 0;
  const totalCGST = taxResult ? taxResult.totalCgstPaise / 100 : 0;
  const totalSGST = taxResult ? taxResult.totalSgstPaise / 100 : 0;
  const totalIGST = taxResult ? taxResult.totalIgstPaise / 100 : 0;

  const rawTotalAmountPaise = taxResult ? taxResult.grandTotalPaise : 0;
  const roundedGrandTotalPaise = roundToRupeePaise(rawTotalAmountPaise);
  const roundOffPaise = roundedGrandTotalPaise - rawTotalAmountPaise;

  const roundOff = roundOffPaise / 100;
  const grandTotal = roundedGrandTotalPaise / 100;

  const gstBreakdownMap: Record<number, GstRateRow> = {};

  // Initialize the map with ALL active tax rates from DB so they always render in order
  for (const tr of sortedTaxRates) {
    const rate = Number(tr.rate_percentage);
    if (!gstBreakdownMap[rate]) {
      gstBreakdownMap[rate] = { ratePercentage: rate, taxableValuePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
    }
  }

  if (taxResult && taxResult.lineItems) {
    for (const item of taxResult.lineItems) {
      const rate = Number(item.taxRatePercentage);
      if (!gstBreakdownMap[rate]) {
        gstBreakdownMap[rate] = { ratePercentage: rate, taxableValuePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
      }
      gstBreakdownMap[rate].taxableValuePaise += item.taxableValuePaise;
      gstBreakdownMap[rate].cgstPaise += item.cgstPaise;
      gstBreakdownMap[rate].sgstPaise += item.sgstPaise;
      gstBreakdownMap[rate].igstPaise += item.igstPaise;
    }
  }

  const sortedGstRates = Object.keys(gstBreakdownMap)
    .map(Number)
    .sort((a, b) => a - b);

  return { taxResult, supplyType, totalTaxable, totalCGST, totalSGST, totalIGST, roundOff, grandTotal, gstBreakdownMap, sortedGstRates };
}

export function buildInvoiceNumberPreview({
  business,
  invoiceDate,
  activeFys,
  previewSequence,
}: {
  business?: { invoice_number_format: string } | null;
  invoiceDate?: string | null;
  activeFys: Array<typeof financialYearsTable.$inferSelect>;
  previewSequence?: number | null;
}): string {
  let invoiceNumberFormatPreview = 'DRAFT';
  if (business && invoiceDate) {
    try {
      const parsedDate = parseIsoDateToIstDate(invoiceDate);
      // Reviewer-accepted hardening: an unparsable date used to render "INV/N-aN/001"; <input type="date"> cannot
      // produce one, so the visible form is unchanged.
      if (isNaN(parsedDate.getTime())) return 'DRAFT';
      const currentLabel = getIndianFinancialYearForDate(parsedDate).label;
      const activeFy = activeFys.find((fy) => fy.label === currentLabel);
      const sequenceValue = previewSequence != null ? previewSequence : (activeFy ? activeFy.invoice_sequence_counter + 1 : 1);

      invoiceNumberFormatPreview = resolveInvoiceNumber(business.invoice_number_format, {
        invoiceDate: parsedDate,
        fyLabel: activeFy ? activeFy.label : currentLabel,
        sequenceValue,
      });
    } catch {
      // return 'DRAFT' on error or invalid date
    }
  }
  return invoiceNumberFormatPreview;
}

export function collectValidationErrors(errors: FieldErrors<InvoiceDraftInput>): string[] {
  const errorList: string[] = [];

  if (errors.billing_name?.message) errorList.push(`Customer Name: ${errors.billing_name.message}`);
  if (errors.billing_gstin?.message) errorList.push(`Customer GSTIN: ${errors.billing_gstin.message}`);
  if (errors.place_of_supply_state_code?.message) errorList.push(`Place of Supply: ${errors.place_of_supply_state_code.message}`);
  if (errors.invoice_date?.message) errorList.push(`Invoice Date: ${errors.invoice_date.message}`);
  if (errors.notes?.message) errorList.push(`Notes: ${errors.notes.message}`);

  if (Array.isArray(errors.line_items)) {
    errors.line_items.forEach((itemError: FieldErrors<InvoiceLineItemInput> | undefined, idx: number) => {
      if (!itemError) return;
      const prefix = `Item Row #${idx + 1}`;
      if (itemError.description?.message) errorList.push(`${prefix}: ${itemError.description.message}`);
      if (itemError.hsn_sac_code?.message) errorList.push(`${prefix}: ${itemError.hsn_sac_code.message}`);
      if (itemError.quantity?.message) errorList.push(`${prefix}: ${itemError.quantity.message}`);
      if (itemError.unit_price?.message) errorList.push(`${prefix}: ${itemError.unit_price.message}`);
      if (itemError.discount?.message) errorList.push(`${prefix}: ${itemError.discount.message}`);
      if (itemError.tax_rate_id?.message) errorList.push(`${prefix}: ${itemError.tax_rate_id.message}`);
    });
  }

  if (errors.line_items?.root?.message) {
    errorList.push(`Line Items: ${errors.line_items.root.message}`);
  }

  return errorList;
}

export function buildPreviewInvoiceData({
  initialId,
  business,
  watchLineItems,
  watchPlaceOfSupplyState,
  watchBillingName,
  watchBillingGstin,
  watchInvoiceDate,
  watchTemplate,
  gstRateTypeVal,
  taxRates,
  selectedCustomer,
  invoiceNumberFormatPreview,
  signatureDataUri,
}: {
  initialId?: string;
  business: CurrentBusiness;
  watchLineItems: InvoiceLineItemInput[];
  watchPlaceOfSupplyState: string;
  watchBillingName: string;
  watchBillingGstin: string;
  watchInvoiceDate: string;
  watchTemplate: string;
  gstRateTypeVal: 'exclusive' | 'inclusive';
  taxRates: Array<typeof taxRatesTable.$inferSelect>;
  selectedCustomer: CustomerOption | null;
  invoiceNumberFormatPreview: string;
  signatureDataUri?: string | null;
}) {
  const indexedInputs = (watchLineItems ?? []).map((li, idx) => {
    const tr = taxRates.find((r) => r.id === li.tax_rate_id);
    const ratePct = tr ? Number(tr.rate_percentage) : 0;
    const input = buildPreviewTaxLineInput({
      quantity: li.quantity,
      unitPriceRupees: li.unit_price,
      discountPercent: li.discount,
      taxRatePercentage: ratePct,
    });
    return { idx, input };
  });

  const validIndexedInputs = indexedInputs.filter(
    (entry): entry is { idx: number; input: TaxLineItemInput } => entry.input !== null
  );

  let previewTaxResult: TaxCalculationResult = {
    supplyType: (watchPlaceOfSupplyState || business.state_code) === business.state_code ? 'intra_state' : 'inter_state',
    lineItems: [],
    subtotalPaise: 0,
    totalCgstPaise: 0,
    totalSgstPaise: 0,
    totalIgstPaise: 0,
    totalTaxPaise: 0,
    grandTotalPaise: 0,
    gstRateType: gstRateTypeVal,
  };

  if (validIndexedInputs.length > 0) {
    try {
      previewTaxResult = calculateInvoiceTax({
        sellerStateCode: business.state_code,
        placeOfSupplyStateCode: watchPlaceOfSupplyState || business.state_code,
        lineItems: validIndexedInputs.map((entry) => entry.input),
        gstRateType: gstRateTypeVal,
      });
    } catch {
      // Fallback to zero summary while user is mid-edit
    }
  }

  const calcByRowIndex = new Map<number, TaxLineItemResult>();
  validIndexedInputs.forEach((entry, validIdx) => {
    const calcItem = previewTaxResult.lineItems[validIdx];
    if (calcItem) calcByRowIndex.set(entry.idx, calcItem);
  });

  const lineItemsMapped = (watchLineItems ?? []).map((li, idx) => {
    const sanitized = indexedInputs[idx]?.input;
    const ratePct = sanitized ? sanitized.taxRatePercentage : 0;
    const calcLi = calcByRowIndex.get(idx) || {
      taxableValuePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      lineTotalPaise: 0,
      taxRatePercentage: ratePct,
    };

    return {
      id: `item-${idx}`,
      description: li.description || '',
      hsn_sac_code: li.hsn_sac_code || '',
      quantity: li.quantity || 0,
      unit_of_measurement: li.unit_of_measurement || 'NOS',
      unit_price_paise: sanitized ? sanitized.unitPricePaise : 0,
      discount_paise: sanitized?.discountPaise ?? 0,
      taxable_value_paise: calcLi.taxableValuePaise,
      tax_rate_percentage: ratePct,
      cgst_paise: calcLi.cgstPaise,
      sgst_paise: calcLi.sgstPaise,
      igst_paise: calcLi.igstPaise,
      line_total_paise: calcLi.lineTotalPaise,
    };
  });

  let billingAddressSnapshot: string | null = null;
  if (selectedCustomer) {
    const cityStatePincode = [selectedCustomer.city, selectedCustomer.state_code, selectedCustomer.pincode]
      .filter(Boolean)
      .join(', ');
    billingAddressSnapshot = [selectedCustomer.address_line1, selectedCustomer.address_line2, cityStatePincode]
      .filter(Boolean)
      .join('\n');
  }

  return {
    id: initialId || 'draft-id',
    business_id: business.id,
    logo_storage_key: business.logo_storage_key,
    signature_data_uri: signatureDataUri ?? null,
    business_name: business.legal_name,
    city: business.city,
    seller_gstin_snapshot: business.gstin ? business.gstin.toUpperCase() : null,
    phone: business.phone,
    nature_of_business: business.nature_of_business || null,
    alternate_phone: business.alternate_phone || null,
    address_line1: business.address_line1,
    address_line2: business.address_line2 || null,
    pincode: business.pincode,
    bank_name: business.bank_name,
    bank_account_number: business.bank_account_number,
    bank_ifsc: business.bank_ifsc ? business.bank_ifsc.toUpperCase() : null,
    invoice_terms: business.invoice_terms,
    invoice_number: invoiceNumberFormatPreview,
    invoice_date: watchInvoiceDate,
    billing_name_snapshot: watchBillingName,
    billing_gstin_snapshot: watchBillingGstin ? watchBillingGstin.toUpperCase() : null,
    billing_address_snapshot: billingAddressSnapshot,
    place_of_supply_state_code: watchPlaceOfSupplyState,
    subtotal_paise: previewTaxResult.subtotalPaise,
    total_cgst_paise: previewTaxResult.totalCgstPaise,
    total_sgst_paise: previewTaxResult.totalSgstPaise,
    total_igst_paise: previewTaxResult.totalIgstPaise,
    total_tax_paise: previewTaxResult.totalTaxPaise,
    grand_total_paise: roundToRupeePaise(previewTaxResult.grandTotalPaise),
    invoice_template: watchTemplate,
    gst_rate_type: gstRateTypeVal,
    subscription_plan: business.subscription_plan,
    subscription_status: business.subscription_status,
    trial_ends_at: business.trial_ends_at,
    customer: selectedCustomer ? { phone: selectedCustomer.phone } : null,
    lineItems: lineItemsMapped,
  };
}
