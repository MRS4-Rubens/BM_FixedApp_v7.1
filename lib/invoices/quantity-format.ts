// Quantity Format: how many decimal places a business allows in line-item quantities (Invoice Settings, Section 1).
//
// Stored in businesses.invoice_display_prefs.quantityDecimals (no migration: missing => 3, today's behaviour).
// The database column stays numeric(10,3), so the setting only narrows what can be ENTERED. Stored quantities are
// never rewritten: finalized invoices, credit notes and PDFs keep exactly what they hold.
//
// Pure module (no React / DB) so the same rules run in the browser and on the server.

import { parseQuantityToMilli } from '@/lib/money';

export const QUANTITY_DECIMAL_OPTIONS = [0, 2, 3] as const;
export type QuantityDecimals = (typeof QUANTITY_DECIMAL_OPTIONS)[number];
export const DEFAULT_QUANTITY_DECIMALS: QuantityDecimals = 3;

export const QUANTITY_FORMAT_LABELS: Record<QuantityDecimals, string> = {
  0: 'Whole numbers (1, 2, 3)',
  2: 'Up to 2 decimals (1.25)',
  3: 'Up to 3 decimals (1.250)',
};

export function isQuantityDecimals(value: unknown): value is QuantityDecimals {
  return typeof value === 'number' && QUANTITY_DECIMAL_OPTIONS.some((option) => option === value);
}

/** Smallest option that can hold a stored quantity (in thousandths): 2500 -> 2 (2.5), 2000 -> 0, 2125 -> 3. */
export function decimalsUsedByMilli(milli: number): QuantityDecimals {
  if (milli % 1000 === 0) return 0;
  if (milli % 10 === 0) return 2;
  return 3;
}

function maxDecimals(...values: QuantityDecimals[]): QuantityDecimals {
  return values.reduce<QuantityDecimals>((a, b) => (b > a ? b : a), 0);
}

/**
 * Credit notes may always use the decimals the ORIGINAL invoice line needed (and whatever is left on it), even when
 * the current setting is stricter. Otherwise an old 2.5 kg line could never be fully credited after switching to
 * whole numbers.
 */
export function creditQuantityDecimals(
  setting: QuantityDecimals,
  originalMilli: number,
  remainingMilli: number,
): QuantityDecimals {
  return maxDecimals(setting, decimalsUsedByMilli(originalMilli), decimalsUsedByMilli(remainingMilli));
}

/** True when the quantity has no more decimal places than allowed. Non-numbers are left to the normal validation. */
export function fitsQuantityDecimals(quantity: number | string, decimals: QuantityDecimals): boolean {
  const milli = parseQuantityToMilli(quantity);
  if (milli === null) return true;
  return decimalsUsedByMilli(milli) <= decimals;
}

/**
 * Server check at finalize. Returns a user-facing message for the first line that breaks the Quantity Format, or
 * null. Each line may carry its own allowance (credit notes widen it per line).
 */
export function quantityFormatViolation(
  lines: ReadonlyArray<{ quantity: number | string; decimals: QuantityDecimals }>,
): string | null {
  const index = lines.findIndex((line) => !fitsQuantityDecimals(line.quantity, line.decimals));
  if (index === -1) return null;
  const line = lines[index]!;
  return `Line ${index + 1}: quantity ${Number(line.quantity)} has more decimal places than allowed. ${quantityFormatMessage(line.decimals)}`;
}

export function quantityFormatMessage(decimals: QuantityDecimals): string {
  return decimals === 0
    ? 'Whole numbers only (Quantity Format in Invoice Settings).'
    : `At most ${decimals} decimal places (Quantity Format in Invoice Settings).`;
}

/** Keys a quantity box ignores: never e/E/+/- ; in whole-number mode also the decimal point. */
export function isBlockedQuantityKey(key: string, decimals: QuantityDecimals): boolean {
  if (key === 'e' || key === 'E' || key === '+' || key === '-') return true;
  return decimals === 0 && (key === '.' || key === ',');
}

/**
 * Cleans what was typed or pasted: keeps digits and one decimal point, then cuts extra decimal places.
 * "2.5" in whole-number mode -> "2"; "1.23456" with 2 decimals -> "1.23"; "1." is kept while typing.
 */
export function sanitizeQuantityText(raw: string, decimals: QuantityDecimals): string {
  const cleaned = raw.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  const whole = cleaned.slice(0, dot);
  if (decimals === 0) return whole;
  const fraction = cleaned.slice(dot + 1).replace(/\./g, '').slice(0, decimals);
  return `${whole}.${fraction}`;
}

/**
 * Shared props for every quantity <input type="number">. step=1 makes the arrows and ↑/↓ keys move by one whole
 * unit in EVERY mode (never by 0.001); typed decimals are still accepted in decimal modes. The forms submit through
 * buttons (no native form validation), so a value like 2.5 with step=1 is never blocked by the browser.
 */
const QUANTITY_INPUT_STEP = '1';

function quantityInputMode(decimals: QuantityDecimals): 'numeric' | 'decimal' {
  return decimals === 0 ? 'numeric' : 'decimal';
}

/**
 * Everything a quantity <input type="number"> needs for a given format: whole-unit arrows, the right phone keyboard,
 * blocked keys, and clean-up of pasted/over-long values. A partly typed value ("1.") reads as '' from a number input
 * and is left alone, so typing is never interrupted.
 */
export function quantityInputGuards(decimals: QuantityDecimals) {
  return {
    step: QUANTITY_INPUT_STEP,
    min: decimals === 0 ? '1' : '0',
    inputMode: quantityInputMode(decimals),
    onKeyDown: (e: { key: string; preventDefault: () => void }) => {
      if (isBlockedQuantityKey(e.key, decimals)) e.preventDefault();
    },
    /** Call first in onChange; rewrites the box's text when it holds more decimals than allowed. */
    clean: (target: { value: string }) => {
      if (target.value === '') return;
      const cleaned = sanitizeQuantityText(target.value, decimals);
      if (cleaned !== target.value) target.value = cleaned;
    },
  };
}
