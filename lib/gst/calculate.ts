import { INDIAN_GST_STATES } from './indian-states';
import { GstCalculationError, MoneyLimitError } from './errors';
import { SupplyType, TaxLineItemInput, TaxLineItemResult, TaxCalculationInput, TaxCalculationResult } from './types';
import { multiplyMilliByPaiseRoundHalfUp, parseQuantityToMilli } from '@/lib/money';
import {
  MAX_DOCUMENT_TOTAL_PAISE,
  MAX_INVOICE_LINE_ITEMS,
  MAX_LINE_GROSS_PAISE,
  MAX_QUANTITY,
  MAX_QUANTITY_LABEL,
  MAX_UNIT_PRICE_LABEL,
  MAX_UNIT_PRICE_PAISE,
  MAX_AMOUNT_LABEL,
} from '../money-limits';

export function getSupplyType(sellerStateCode: string, placeOfSupplyStateCode: string): SupplyType {
  const sellerState = INDIAN_GST_STATES.find(s => s.code === sellerStateCode);
  if (!sellerState) {
    throw new GstCalculationError(`Invalid sellerStateCode: ${sellerStateCode}`);
  }
  const posState = INDIAN_GST_STATES.find(s => s.code === placeOfSupplyStateCode);
  if (!posState) {
    throw new GstCalculationError(`Invalid placeOfSupplyStateCode: ${placeOfSupplyStateCode}`);
  }

  if (sellerStateCode === placeOfSupplyStateCode) {
    return 'intra_state';
  }
  return 'inter_state';
}

function calculateLineItem(
  item: TaxLineItemInput,
  supplyType: SupplyType,
  gstRateType: 'inclusive' | 'exclusive' = 'exclusive'
): TaxLineItemResult {
  if (item.quantity <= 0) {
    throw new GstCalculationError('Quantity must be greater than 0');
  }
  if (item.unitPricePaise < 0) {
    throw new GstCalculationError('Unit price must be non-negative');
  }
  if (item.taxRatePercentage < 0 || item.taxRatePercentage > 100) {
    throw new GstCalculationError('Tax rate percentage must be between 0 and 100');
  }
  const discountPaise = item.discountPaise ?? 0;
  if (discountPaise < 0) {
    throw new GstCalculationError('Discount must be non-negative');
  }

  if (!Number.isFinite(item.quantity)) {
    throw new GstCalculationError('Quantity must be a finite number');
  }
  if (!Number.isSafeInteger(item.unitPricePaise)) {
    throw new GstCalculationError('Unit price must be a whole number of paise');
  }
  if (item.quantity > MAX_QUANTITY) {
    throw new MoneyLimitError(`Quantity cannot exceed ${MAX_QUANTITY_LABEL}.`);
  }
  if (item.unitPricePaise > MAX_UNIT_PRICE_PAISE) {
    throw new MoneyLimitError(`Rate cannot exceed ${MAX_UNIT_PRICE_LABEL}.`);
  }

  const quantityMilli = parseQuantityToMilli(item.quantity);
  let grossPaise: number;
  if (quantityMilli !== null) {
    try {
      grossPaise = multiplyMilliByPaiseRoundHalfUp(quantityMilli, item.unitPricePaise);
    } catch {
      throw new MoneyLimitError(`A line amount cannot exceed ${MAX_AMOUNT_LABEL}. Reduce the quantity or rate.`);
    }
  } else if (typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity >= 0) {
    grossPaise = Math.round(item.quantity * item.unitPricePaise);
  } else {
    throw new GstCalculationError('Quantity can have at most 3 decimal places');
  }

  // Plain comparison on purpose: at the extreme input bounds the raw product exceeds 2^53 and loses precision,
  // but such a value is rejected here, so the imprecision never reaches any stored amount.
  if (grossPaise > MAX_LINE_GROSS_PAISE) {
    throw new MoneyLimitError(`A line amount cannot exceed ${MAX_AMOUNT_LABEL}. Reduce the quantity or rate.`);
  }

  if (discountPaise > grossPaise) {
    throw new GstCalculationError("Discount cannot exceed the line item's gross value");
  }

  const rateBasisPoints = Math.round(item.taxRatePercentage * 100);
  let taxableValuePaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  let lineTotalPaise = 0;

  if (gstRateType === 'inclusive') {
    // Case 3 (Inclusive Forward): Net line total including tax is computed directly from inclusive rate
    lineTotalPaise = grossPaise - discountPaise;
    
    // Extract base taxable value by backing out the tax: LineTotal / (1 + TaxRate/100)
    taxableValuePaise = Math.round((lineTotalPaise * 10000) / (10000 + rateBasisPoints));
    
    // Calculate taxes based on the extracted taxable value
    if (supplyType === 'intra_state') {
      cgstPaise = Math.round((taxableValuePaise * (rateBasisPoints / 2)) / 10000);
      sgstPaise = cgstPaise;
    } else {
      igstPaise = Math.round((taxableValuePaise * rateBasisPoints) / 10000);
    }
    
    // Adjust taxable value slightly so that TaxableValue + CGST + SGST (or IGST) matches LineTotal exactly (prevent rounding leakage)
    const calculatedTotalTaxPaise = cgstPaise + sgstPaise + igstPaise;
    taxableValuePaise = lineTotalPaise - calculatedTotalTaxPaise;
  } else {
    // Case 1 (Exclusive Forward): Base taxable value is computed, then tax is added on top
    taxableValuePaise = grossPaise - discountPaise;
    
    if (supplyType === 'intra_state') {
      cgstPaise = Math.round((taxableValuePaise * (rateBasisPoints / 2)) / 10000);
      sgstPaise = cgstPaise;
      lineTotalPaise = taxableValuePaise + cgstPaise + sgstPaise;
    } else {
      igstPaise = Math.round((taxableValuePaise * rateBasisPoints) / 10000);
      lineTotalPaise = taxableValuePaise + igstPaise;
    }
  }

  return {
    quantity: item.quantity,
    unitPricePaise: item.unitPricePaise,
    discountPaise,
    taxableValuePaise,
    taxRatePercentage: item.taxRatePercentage,
    cgstPaise,
    sgstPaise,
    igstPaise,
    lineTotalPaise
  };
}

export function calculateInvoiceTax(input: TaxCalculationInput): TaxCalculationResult {
  if (!input.lineItems || input.lineItems.length === 0) {
    throw new GstCalculationError("At least one line item is required");
  }
  if (input.lineItems.length > MAX_INVOICE_LINE_ITEMS) {
    throw new MoneyLimitError(`A document cannot have more than ${MAX_INVOICE_LINE_ITEMS} line items.`);
  }

  const supplyType = getSupplyType(input.sellerStateCode, input.placeOfSupplyStateCode);
  const gstRateType = input.gstRateType || 'exclusive';

  // Authoritatively calculate each line item with correct supply type and rate mode
  const lineItems: TaxLineItemResult[] = input.lineItems.map(item => calculateLineItem(item, supplyType, gstRateType));

  let subtotalPaise = 0;
  let totalCgstPaise = 0;
  let totalSgstPaise = 0;
  let totalIgstPaise = 0;

  for (const line of lineItems) {
    subtotalPaise += line.taxableValuePaise;
    totalCgstPaise += line.cgstPaise;
    totalSgstPaise += line.sgstPaise;
    totalIgstPaise += line.igstPaise;
  }

  const totalTaxPaise = totalCgstPaise + totalSgstPaise + totalIgstPaise;
  const grandTotalPaise = subtotalPaise + totalTaxPaise;

  if (grandTotalPaise > MAX_DOCUMENT_TOTAL_PAISE) {
    throw new MoneyLimitError(`The document total cannot exceed ${MAX_AMOUNT_LABEL}.`);
  }

  return {
    supplyType,
    lineItems,
    subtotalPaise,
    totalCgstPaise,
    totalSgstPaise,
    totalIgstPaise,
    totalTaxPaise,
    grandTotalPaise,
    gstRateType
  };
}
