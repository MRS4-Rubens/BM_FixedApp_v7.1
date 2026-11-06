import { MAX_DOCUMENT_TOTAL_PAISE, MAX_UNIT_PRICE_PAISE } from '@/lib/validations/limits';
import type { TaxCalculationResult, TaxLineItemInput } from '@/lib/gst/types';
import { multiplyMilliByPaiseRoundHalfUp, parseQuantityToMilli, parseRupeesToPaise, percentOfPaiseRoundHalfUp } from '@/lib/money';

export type LineMathErrorCode =
  | 'INVALID_QUANTITY'
  | 'INVALID_UNIT_PRICE'
  | 'INVALID_DISCOUNT'
  | 'LINE_VALUE_TOO_LARGE'
  | 'DOCUMENT_TOTAL_TOO_LARGE';

export class LineMathError extends Error {
  readonly code: LineMathErrorCode;
  constructor(code: LineMathErrorCode, message: string) {
    super(message);
    this.name = 'LineMathError';
    this.code = code;
  }
}

export interface LineMoneyInput {
  readonly quantity: number;
  readonly unitPriceRupees: number;
  readonly discountPercent: number;
  readonly taxRatePercentage: number;
}

/** Strict: throws LineMathError. Used by the server. */
export function buildTaxLineInput(input: LineMoneyInput): TaxLineItemInput {
  const quantityMilli = parseQuantityToMilli(input.quantity);
  if (quantityMilli === null || quantityMilli <= 0) {
    throw new LineMathError('INVALID_QUANTITY', 'Quantity must be greater than 0 with at most 3 decimal places.');
  }
  const unitPricePaise = parseRupeesToPaise(input.unitPriceRupees);
  if (unitPricePaise === null) {
    throw new LineMathError('INVALID_UNIT_PRICE', 'Rate must be a non-negative amount with at most 2 decimal places.');
  }
  if (unitPricePaise > MAX_UNIT_PRICE_PAISE) {
    throw new LineMathError('INVALID_UNIT_PRICE', 'Rate is too large.');
  }
  if (!Number.isInteger(input.discountPercent) || input.discountPercent < 0 || input.discountPercent > 100) {
    throw new LineMathError('INVALID_DISCOUNT', 'Discount must be a whole number between 0 and 100.');
  }
  let grossPaise: number;
  try {
    grossPaise = multiplyMilliByPaiseRoundHalfUp(quantityMilli, unitPricePaise);
  } catch {
    throw new LineMathError('LINE_VALUE_TOO_LARGE', 'A line value is too large.');
  }
  if (grossPaise > MAX_DOCUMENT_TOTAL_PAISE) {
    throw new LineMathError('LINE_VALUE_TOO_LARGE', 'A line value exceeds the maximum supported amount.');
  }
  return {
    quantity: input.quantity,
    unitPricePaise,
    discountPaise: percentOfPaiseRoundHalfUp(grossPaise, input.discountPercent),
    taxRatePercentage: input.taxRatePercentage,
  };
}

/** Lenient: for live form previews while the user is typing. Returns null for lines that cannot be priced yet. */
export function buildPreviewTaxLineInput(input: {
  readonly quantity: unknown;
  readonly unitPriceRupees: unknown;
  readonly discountPercent: unknown;
  readonly taxRatePercentage: number;
}): TaxLineItemInput | null {
  const quantity = Number(input.quantity);
  const unitPrice = parseRupeesToPaise(Number(input.unitPriceRupees) || 0) === null ? 0 : Number(input.unitPriceRupees) || 0;
  const discountRaw = Number(input.discountPercent) || 0;
  const discountPercent = Number.isInteger(discountRaw) ? Math.min(100, Math.max(0, discountRaw)) : 0;
  try {
    return buildTaxLineInput({
      quantity,
      unitPriceRupees: unitPrice,
      discountPercent,
      taxRatePercentage: input.taxRatePercentage,
    });
  } catch {
    return null;
  }
}

/** Reject results that would overflow the column type (checked BEFORE any insert). */
export function assertTaxResultWithinCeiling(result: TaxCalculationResult): void {
  const values = [
    result.subtotalPaise,
    result.totalTaxPaise,
    result.grandTotalPaise,
    ...result.lineItems.map((line) => line.lineTotalPaise),
  ];
  if (values.some((value) => value > MAX_DOCUMENT_TOTAL_PAISE)) {
    throw new LineMathError(
      'DOCUMENT_TOTAL_TOO_LARGE',
      'The invoice total exceeds the maximum supported amount. Please split it into more than one invoice.',
    );
  }
}
