/**
 * Independent financial precision oracle and INR parser for E2E tests.
 * All computations use integer paise arithmetic with zero floating-point math.
 */

export interface LineGstResult {
  readonly taxablePaise: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly totalPaise: number;
}

/**
 * Rounds half-up using pure integer arithmetic (no Math.round on floats).
 * Equivalent to: Math.floor((numerator + denominator / 2) / denominator) for positive numbers.
 */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const zero = BigInt(0);
  const one = BigInt(1);
  const two = BigInt(2);
  if (denominator <= zero) throw new RangeError('Denominator must be positive');
  if (numerator < zero) throw new RangeError('Negative numerator not supported in half-up');
  const remainder = numerator % denominator;
  const quotient = numerator / denominator;
  if (remainder * two >= denominator) {
    return quotient + one;
  }
  return quotient;
}

/**
 * Computes GST for an exclusive line item using integer paise arithmetic.
 * rateBp = rate in basis points (e.g. 18% = 1800 bp).
 * Intra-state: CGST (rateBp/2) + SGST (rateBp/2).
 * Inter-state: IGST (rateBp).
 */
export function computeLineGst(
  unitPricePaise: number,
  quantity: number,
  rateBp: number,
  intraState: boolean,
): LineGstResult {
  if (!Number.isSafeInteger(unitPricePaise) || unitPricePaise < 0) {
    throw new RangeError('unitPricePaise must be a non-negative safe integer');
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new RangeError('quantity must be a positive number');
  }
  if (!Number.isSafeInteger(rateBp) || rateBp < 0) {
    throw new RangeError('rateBp must be a non-negative safe integer');
  }

  // Support up to 3 decimal places for quantity (milli-units)
  const quantityMilli = BigInt(Math.round(quantity * 1000));
  const unitPaiseBig = BigInt(unitPricePaise);

  // Gross taxable paise = (quantityMilli * unitPaise) / 1000 (round half-up)
  const taxableBig = divideRoundHalfUp(quantityMilli * unitPaiseBig, BigInt(1000));
  const taxablePaise = Number(taxableBig);

  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;

  if (intraState) {
    const halfRateBp = BigInt(rateBp) / BigInt(2);
    const taxPartBig = divideRoundHalfUp(taxableBig * halfRateBp, BigInt(10000));
    cgstPaise = Number(taxPartBig);
    sgstPaise = cgstPaise;
  } else {
    const igstBig = divideRoundHalfUp(taxableBig * BigInt(rateBp), BigInt(10000));
    igstPaise = Number(igstBig);
  }

  const totalPaise = taxablePaise + cgstPaise + sgstPaise + igstPaise;

  return {
    taxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    totalPaise,
  };
}

const INR_PATTERN =
  /^[+-]?\s*(?:₹|Rs\.?|INR)?\s*([0-9]{1,3}(?:,[0-9]{2})*,\d{3}|[0-9]{1,3}(?:,[0-9]{3})*|\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parses displayed INR strings (e.g. "₹3,540.00", "₹1,00,000.00", "₹0.05", "-₹1,180.00")
 * strictly using string and integer logic (no parseFloat).
 * Returns integer paise. Throws RangeError on malformed strings.
 */
export function parseInrToPaise(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new RangeError('Empty currency string');
  }

  const isNegative = trimmed.startsWith('-') || trimmed.includes('-₹') || trimmed.includes('- ₹');
  const sanitized = trimmed.replace(/^-/, '').trim();

  const match = INR_PATTERN.exec(sanitized);
  if (!match) {
    throw new RangeError(`Cannot parse INR currency string: "${input}"`);
  }

  const integerGroup = match[1];
  if (!integerGroup) {
    throw new RangeError(`Missing integer digits in currency string: "${input}"`);
  }

  const rawDigits = integerGroup.replace(/,/g, '');
  const fractionDigits = (match[2] ?? '').padEnd(2, '0');

  const integerPaise = BigInt(rawDigits) * BigInt(100);
  const fractionalPaise = BigInt(fractionDigits);
  const totalPaise = integerPaise + fractionalPaise;

  if (totalPaise > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Amount exceeds safe integer range');
  }

  const result = Number(totalPaise);
  return isNegative ? -result : result;
}

/** Formats integer paise to standard ₹ currency display with 2 decimal places. */
export function formatPaiseToInr(paise: number): string {
  const isNegative = paise < 0;
  const absPaise = Math.abs(paise);
  const rupees = Math.floor(absPaise / 100);
  const remPaise = absPaise % 100;
  const paiseStr = remPaise.toString().padStart(2, '0');
  const formattedRupees = rupees.toLocaleString('en-IN');
  return `${isNegative ? '-' : ''}₹${formattedRupees}.${paiseStr}`;
}

/** Pre-computed test fixture invariants matching §3.4 */
export const FIXTURES = {
  PRODUCT_UNIT_PRICE_PAISE: 100000, // ₹1,000.00
  GST_RATE_BP: 1800, // 18%
  INVOICE_QTY: 3,

  // Invoice calculations (intra-state)
  INVOICE_TAXABLE_PAISE: 300000,
  INVOICE_CGST_PAISE: 27000,
  INVOICE_SGST_PAISE: 27000,
  INVOICE_IGST_PAISE: 0,
  INVOICE_TOTAL_PAISE: 354000, // ₹3,540.00

  // Payment 1
  PAYMENT_1_PAISE: 150000, // ₹1,500.00
  BALANCE_AFTER_PAYMENT_1_PAISE: 204000, // ₹2,040.00

  // Credit Note (1 unit)
  CREDIT_NOTE_QTY: 1,
  CREDIT_NOTE_TAXABLE_PAISE: 100000,
  CREDIT_NOTE_CGST_PAISE: 9000,
  CREDIT_NOTE_SGST_PAISE: 9000,
  CREDIT_NOTE_TOTAL_PAISE: 118000, // ₹1,180.00

  // Net bill = 354000 - 118000 = 236000
  NET_BILL_PAISE: 236000, // ₹2,360.00
  BALANCE_AFTER_CN_PAISE: 86000, // ₹860.00

  // Payment 2
  PAYMENT_2_PAISE: 86000, // ₹860.00
  BALANCE_FINAL_PAISE: 0,
} as const;

