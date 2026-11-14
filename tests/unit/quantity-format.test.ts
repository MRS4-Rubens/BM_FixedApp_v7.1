import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_QUANTITY_DECIMALS,
  QUANTITY_FORMAT_LABELS,
  creditQuantityDecimals,
  decimalsUsedByMilli,
  fitsQuantityDecimals,
  isBlockedQuantityKey,
  isQuantityDecimals,
  quantityFormatViolation,
  quantityInputGuards,
  sanitizeQuantityText,
} from '@/lib/invoices/quantity-format';

describe('Quantity Format rules', () => {
  it('offers whole numbers, 2 and 3 decimals; default is 3 (no change for existing accounts)', () => {
    expect(DEFAULT_QUANTITY_DECIMALS).toBe(3);
    expect(Object.keys(QUANTITY_FORMAT_LABELS)).toEqual(['0', '2', '3']);
    expect([0, 2, 3].every(isQuantityDecimals)).toBe(true);
    expect([1, 4, '2', null, 2.5].some(isQuantityDecimals)).toBe(false);
  });

  it('measures the decimals a stored quantity needs', () => {
    expect(decimalsUsedByMilli(2000)).toBe(0);
    expect(decimalsUsedByMilli(2500)).toBe(2); // 2.5
    expect(decimalsUsedByMilli(2250)).toBe(2); // 2.25
    expect(decimalsUsedByMilli(2125)).toBe(3); // 2.125
  });

  it('checks a quantity against a format (numbers or stored strings like "2.500")', () => {
    expect(fitsQuantityDecimals(2, 0)).toBe(true);
    expect(fitsQuantityDecimals('2.000', 0)).toBe(true);
    expect(fitsQuantityDecimals('2.500', 0)).toBe(false);
    expect(fitsQuantityDecimals(1.25, 2)).toBe(true);
    expect(fitsQuantityDecimals(1.125, 2)).toBe(false);
    expect(fitsQuantityDecimals(1.125, 3)).toBe(true);
    expect(fitsQuantityDecimals('', 0)).toBe(true); // left to the normal "required" validation
  });

  it('credit notes widen the format to what the original or remaining quantity needs', () => {
    expect(creditQuantityDecimals(0, 3000, 3000)).toBe(0); // 3 NOS
    expect(creditQuantityDecimals(0, 2500, 2500)).toBe(2); // 2.5 kg billed
    expect(creditQuantityDecimals(0, 3000, 2875)).toBe(3); // 2.875 left after an earlier 0.125 credit
    expect(creditQuantityDecimals(3, 3000, 3000)).toBe(3); // never narrower than the setting
  });

  it('finalize check names the first offending line', () => {
    expect(quantityFormatViolation([{ quantity: '2.000', decimals: 0 }])).toBeNull();
    const msg = quantityFormatViolation([
      { quantity: '3.000', decimals: 0 },
      { quantity: '2.500', decimals: 0 },
    ]);
    expect(msg).toMatch(/^Line 2: quantity 2\.5 has more decimal places than allowed\. Whole numbers only/);
    expect(quantityFormatViolation([{ quantity: 1.125, decimals: 2 }])).toMatch(/At most 2 decimal places/);
  });

  it('blocks e/E/+/- always, and the decimal point only in whole-number mode', () => {
    for (const key of ['e', 'E', '+', '-']) {
      expect(isBlockedQuantityKey(key, 3)).toBe(true);
    }
    expect(isBlockedQuantityKey('.', 0)).toBe(true);
    expect(isBlockedQuantityKey(',', 0)).toBe(true);
    expect(isBlockedQuantityKey('.', 2)).toBe(false);
    expect(isBlockedQuantityKey('5', 0)).toBe(false);
    expect(isBlockedQuantityKey('ArrowUp', 0)).toBe(false);
  });

  it('cleans pasted or over-long values', () => {
    expect(sanitizeQuantityText('2.5', 0)).toBe('2');
    expect(sanitizeQuantityText('1.23456', 2)).toBe('1.23');
    expect(sanitizeQuantityText('1.23456', 3)).toBe('1.234');
    expect(sanitizeQuantityText('1,5', 2)).toBe('1.5');
    expect(sanitizeQuantityText('12', 0)).toBe('12');
  });

  it('input guards: arrows step by 1 in every mode; whole numbers start at 1 and use the numeric keypad', () => {
    expect(quantityInputGuards(0)).toMatchObject({ step: '1', min: '1', inputMode: 'numeric' });
    expect(quantityInputGuards(2)).toMatchObject({ step: '1', min: '0', inputMode: 'decimal' });
    expect(quantityInputGuards(3)).toMatchObject({ step: '1', min: '0', inputMode: 'decimal' });

    const box = { value: '2.75' };
    quantityInputGuards(0).clean(box);
    expect(box.value).toBe('2');
    const partly = { value: '' }; // a number input reads "1." as '' while typing: left alone
    quantityInputGuards(2).clean(partly);
    expect(partly.value).toBe('');

    let prevented = false;
    quantityInputGuards(0).onKeyDown({ key: '.', preventDefault: () => (prevented = true) });
    expect(prevented).toBe(true);
  });

  it('no quantity box in the invoice or credit note forms steps by 0.001 any more', () => {
    for (const file of ['components/app/invoices/invoice-form/line-item-row.tsx', 'components/app/credit-notes/credit-note-form.tsx']) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      expect(src, file).not.toContain('step="0.001"');
      expect(src, file).toContain('quantityInputGuards(');
    }
  });
});
