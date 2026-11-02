/**
 * Money handling utilities
 * 
 * In this application, all monetary amounts are stored in the database as an integer number of paise
 * (e.g., ₹19.99 is stored as 1999) to avoid floating-point errors during calculations.
 * 
 * - `paise`: Always an integer representing the smallest currency unit.
 * - `rupees`: Always a plain JavaScript number (can have decimals).
 */

const RUPEE_AMOUNT_PATTERN = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

/**
 * Exact, decimal-safe conversion of a rupee amount to integer paise.
 * Parses the decimal STRING (no floating-point multiplication). Returns null for anything that is not a plain
 * non-negative decimal with at most two fractional digits (negatives, exponents like 1e-7, NaN/Infinity,
 * 3+ decimals such as 0.004 or 0.30000000000000004). Foundation for API-006's broader money helpers.
 */
export function parseRupeesToPaise(input: string | number): number | null {
  const text = typeof input === 'number' ? (Number.isFinite(input) ? String(input) : '') : input.trim();
  const match = RUPEE_AMOUNT_PATTERN.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/**
 * Converts a rupee amount (e.g. from a form input) to an integer number of paise.
 * Uses exact string parsing (no floating-point multiplication) to prevent rounding drift.
 * Throws RangeError if the input cannot be represented as an exact non-negative paisa integer.
 */
export function rupeesToPaise(rupees: number): number {
  const paise = parseRupeesToPaise(rupees);
  if (paise === null) {
    throw new RangeError('Invalid rupee amount');
  }
  return paise;
}

/**
 * Converts an integer number of paise to rupees for pre-filling form inputs or calculations.
 */
export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/**
 * Formats an integer number of paise as a display string using Indian digit grouping
 * and the ₹ symbol (e.g. 150050 -> "₹1,500.50").
 */
export function formatPaiseAsInr(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

const QUANTITY_PATTERN = /^(\d{1,7})(?:\.(\d{1,3}))?$/;

/** Exact quantity -> thousandths. Null for exponents, NaN/Infinity, >3 decimals, >7 integer digits. Zero is returned as 0. */
export function parseQuantityToMilli(input: string | number): number | null {
  const text = typeof input === 'number' ? (Number.isFinite(input) ? String(input) : '') : input.trim();
  const match = QUANTITY_PATTERN.exec(text);
  if (!match) return null;
  return Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
}

/** round-half-up(quantityMilli * pricePaise / 1000) in exact integer arithmetic. */
export function multiplyMilliByPaiseRoundHalfUp(quantityMilli: number, pricePaise: number): number {
  assertNonNegativeSafeInteger(quantityMilli, 'quantityMilli');
  assertNonNegativeSafeInteger(pricePaise, 'pricePaise');
  const result = (BigInt(quantityMilli) * BigInt(pricePaise) + BigInt(500)) / BigInt(1000);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Amount is too large');
  return Number(result);
}

/** round-half-up(amountPaise * percent / 100) for an INTEGER percent 0..100. */
export function percentOfPaiseRoundHalfUp(amountPaise: number, percent: number): number {
  assertNonNegativeSafeInteger(amountPaise, 'amountPaise');
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new RangeError('percent must be an integer between 0 and 100');
  return Number((BigInt(amountPaise) * BigInt(percent) + BigInt(50)) / BigInt(100));
}
