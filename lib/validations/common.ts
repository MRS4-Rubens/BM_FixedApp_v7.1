import { z } from 'zod';
import { INDIAN_GST_STATES } from '@/lib/gst/indian-states';
import { isValidGstinChecksum } from '@/lib/gst/gstin';
import { INVOICE_TEMPLATE_IDS } from '@/lib/invoices/template-ids';
import { isValidIsoDate } from '@/lib/invoices/ist-date';
import { parseQuantityToMilli, parseRupeesToPaise } from '@/lib/money';
import { GSTIN_REGEX } from '@/lib/validations/patterns';
import { ISO_DATE_MAX_YEAR, ISO_DATE_MIN_YEAR, MAX_QUANTITY } from '@/lib/validations/limits';
import { MAX_QUANTITY_LABEL } from '@/lib/money-limits';

export const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date (YYYY-MM-DD)')
  .refine(isValidIsoDate, 'Enter a valid calendar date')
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    return year >= ISO_DATE_MIN_YEAR && year <= ISO_DATE_MAX_YEAR;
  }, `Year must be between ${ISO_DATE_MIN_YEAR} and ${ISO_DATE_MAX_YEAR}`);

export function moneyRupees(options: {
  readonly label: string;
  readonly max: number;
  readonly min?: number;
  readonly maxMessage?: string;
}) {
  const { label, max, min = 0, maxMessage } = options;
  return z.coerce
    .number({ error: `Enter a valid ${label.toLowerCase()}` })
    .min(min, `${label} cannot be negative`)
    .max(max, maxMessage ?? `${label} is too large`)
    .refine((value) => parseRupeesToPaise(value) !== null, `${label} can have at most 2 decimal places`);
}

export function hasValidQuantityPrecision(value: number): boolean {
  return parseQuantityToMilli(value) !== null;
}

export const quantity = z.coerce
  .number({ error: 'Enter a valid quantity' })
  .positive('Quantity must be greater than 0')
  .max(MAX_QUANTITY, `Quantity cannot exceed ${MAX_QUANTITY_LABEL}`)
  .refine(hasValidQuantityPrecision, 'Quantity can have at most 3 decimal places');

export const stateCode = z
  .string()
  .refine((value) => INDIAN_GST_STATES.some((state) => state.code === value), 'Select a valid place of supply state');

export const templateId = z.enum(INVOICE_TEMPLATE_IDS, { error: 'Select a valid invoice template' });

export const gstin = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(
    z
      .string()
      .regex(GSTIN_REGEX, 'Invalid GSTIN format')
      .refine(isValidGstinChecksum, 'This GSTIN looks invalid (checksum mismatch). Please re-check the number.'),
  );
