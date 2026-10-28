/**
 * Money handling utilities
 * 
 * In this application, all monetary amounts are stored in the database as an integer number of paise
 * (e.g., ₹19.99 is stored as 1999) to avoid floating-point errors during calculations.
 * 
 * - `paise`: Always an integer representing the smallest currency unit.
 * - `rupees`: Always a plain JavaScript number (can have decimals).
 */

/**
 * Converts a rupee amount (e.g. from a form input) to an integer number of paise.
 * Uses Math.round to avoid floating-point drift (e.g. 19.99 * 100).
 */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
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

