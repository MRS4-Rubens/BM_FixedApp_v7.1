import { z } from 'zod';
import { GSTIN_REGEX, PAN_REGEX, IFSC_REGEX, PINCODE_REGEX } from './patterns';
import { INDIAN_GST_STATES } from '@/lib/gst/indian-states';
import { validateInvoiceNumberFormat } from '@/lib/invoices/number-format';
import {
  CREDIT_NOTE_PREFIX_LENGTH_MESSAGE,
  CREDIT_NOTE_PREFIX_MAX_LENGTH,
  CREDIT_NOTE_PREFIX_PATTERN,
} from '@/lib/invoices/credit-note-prefix';
import { INVOICE_TEMPLATE_IDS } from '@/lib/invoices/template-ids';
import {
  INVOICE_TAGLINE_MAX,
  INVOICE_TAGLINE_ALLOWED,
  normaliseInvoiceTagline,
} from '@/lib/business/invoice-tagline';

export const legalBusinessNameSchema = z.string().trim().min(1, 'Legal business name is required').max(200);

export function primaryPhoneError(value: string, required: boolean): string | undefined {
  const phone = value.trim();
  if (!phone) return required ? 'Primary phone is required.' : undefined;
  if (!/^(?:\+91|0)?[1-9]\d{9}$/.test(phone.replace(/[\s()-]/g, ''))) {
    return 'Enter a valid Indian mobile or landline number, including the area code for a landline.';
  }
}

export const businessProfileSchema = z.object({
  legal_name: legalBusinessNameSchema,
  expected_identity: z.object({
    legal_name: legalBusinessNameSchema,
    gstin: z.string().max(15),
    state_code: z.string().length(2),
  }).optional(),
  trade_name: z.string().max(200).optional().or(z.literal('')),
  gstin: z.string().transform((v) => v.toUpperCase()).pipe(z.string().regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN')),
  pan: z.string().transform((v) => v.toUpperCase()).pipe(z.string().regex(PAN_REGEX, 'Enter a valid 10-character PAN')).optional().or(z.literal('')),
  registration_type: z.enum(['regular', 'composition']),
  address_line1: z.string().min(1, 'Address is required').max(300),
  address_line2: z.string().max(300).optional().or(z.literal('')),
  city: z.string().min(1, 'City is required').max(100),
  state_code: z.string().min(2).max(2),
  pincode: z.string().regex(PINCODE_REGEX, 'Enter a valid 6-digit pincode'),
  phone: z.string().max(24).optional(),
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
  bank_account_name: z.string().max(200).optional().or(z.literal('')),
  bank_account_number: z.string().max(30).optional().or(z.literal('')),
  bank_ifsc: z.string().transform((v) => v.toUpperCase()).pipe(z.string().regex(IFSC_REGEX, 'Enter a valid IFSC code')).optional().or(z.literal('')),
  bank_name: z.string().max(200).optional().or(z.literal('')),
  invoice_number_format: z
    .string()
    .optional()
    .transform((v) => (v ? v.toUpperCase() : v))
    .superRefine((val, ctx) => {
    if (!val) return;
    const validState = validateInvoiceNumberFormat(val);
    if (!validState.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: validState.error,
      });
    }
  }),
  credit_note_number_prefix: z.string().max(CREDIT_NOTE_PREFIX_MAX_LENGTH, CREDIT_NOTE_PREFIX_LENGTH_MESSAGE).regex(CREDIT_NOTE_PREFIX_PATTERN, 'Only letters, numbers, / and - are allowed').optional().or(z.literal('')),
  invoice_terms: z.string().max(2000).optional(),
  payment_due_days: z.coerce.number().int().min(0).max(365).optional(),
  // API-007: NO `.default(...)`. "Not supplied" must stay `undefined`; a zod default would make every profile
  // edit overwrite the stored setting (and be re-sent by the form's resolver output).
  // These settings are only honoured on first-time setup (the edit path ignores them).
  default_invoice_template: z.enum(INVOICE_TEMPLATE_IDS).optional(),
  default_gst_rate_type: z.enum(['inclusive', 'exclusive']).optional(),
  nature_of_business: z.string().max(200).optional().or(z.literal('')),
  invoice_tagline: z.string().max(200).optional().or(z.literal(''))
    .refine((v) => (normaliseInvoiceTagline(v)?.length ?? 0) <= INVOICE_TAGLINE_MAX, { message: `Keep the tagline to ${INVOICE_TAGLINE_MAX} characters or fewer` })
    .refine((v) => INVOICE_TAGLINE_ALLOWED.test(normaliseInvoiceTagline(v) ?? ''), { message: "Use letters, numbers, spaces and & @ , . ; : - / ( ) ' + | only" }),
  alternate_phone: z.string().max(15).optional().or(z.literal('')),
}).refine(
  (data) => INDIAN_GST_STATES.some((s) => s.code === data.state_code),
  { message: 'Select a valid state', path: ['state_code'] }
).refine(
  (data) => data.gstin.slice(0, 2) === data.state_code,
  { message: 'The GSTIN\'s state code does not match the selected registered state', path: ['gstin'] }
);

export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;
