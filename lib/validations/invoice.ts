import { z } from 'zod';
import { UNIT_OF_MEASUREMENT_OPTIONS } from '@/lib/gst/units';
import { GSTIN_REGEX } from '@/lib/validations/patterns';
import { isValidIsoCalendarDate } from '@/lib/invoices/invoice-date-policy';
import { formatIstDateAsIso } from '@/lib/invoices/ist-date';
import { INVOICE_TEMPLATE_IDS } from '@/lib/invoices/template-ids';
import {
  MAX_QUANTITY,
  MAX_QUANTITY_LABEL,
  MAX_UNIT_PRICE_RUPEES,
  MAX_UNIT_PRICE_LABEL,
  MAX_LINE_GROSS_PAISE,
  MAX_INVOICE_LINE_ITEMS,
  MAX_AMOUNT_LABEL,
} from '@/lib/money-limits';

export const invoiceLineItemSchema = z.object({
  product_id: z.string().uuid().optional().nullable().or(z.literal('')),
  description: z.string().min(1, 'Description is required').max(300, 'Description cannot exceed 300 characters'),
  hsn_sac_code: z.string().regex(/^\d{4}$|^\d{6}$|^\d{8}$/, 'HSN/SAC must be 4, 6, or 8 digits'),
  quantity: z.coerce
    .number()
    .positive('Quantity must be greater than 0')
    .max(MAX_QUANTITY, `Quantity cannot exceed ${MAX_QUANTITY_LABEL}`),
  unit_of_measurement: z.enum(UNIT_OF_MEASUREMENT_OPTIONS),
  unit_price: z.coerce
    .number()
    .min(0, 'Rate cannot be negative')
    .max(MAX_UNIT_PRICE_RUPEES, `Rate cannot exceed ${MAX_UNIT_PRICE_LABEL}`),
  discount: z.coerce.number().int('Discount percentage must be an integer').min(0, 'Discount percentage cannot be negative').max(100, 'Discount percentage cannot exceed 100%').default(0),
  tax_rate_id: z.string().uuid('Select a valid GST Rate')
});

export const invoiceDraftSchema = z.object({
  id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional().nullable().or(z.literal('')),
  billing_name: z.string().min(1, 'Customer name is required').max(200),
  billing_gstin: z.string().transform((v) => v.toUpperCase()).pipe(z.string().regex(GSTIN_REGEX, 'Invalid GSTIN format')).optional().nullable().or(z.literal('')),
  place_of_supply_state_code: z.string().length(2, 'Select a valid place of supply state'),
  invoice_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format')
    .refine((value) => isValidIsoCalendarDate(value), 'Invalid date')
    .refine((value) => value <= formatIstDateAsIso(new Date()), 'Invoice date cannot be in the future')
    .optional(),
  notes: z.string().max(1000).optional().or(z.literal('')),
  invoice_template: z.enum(INVOICE_TEMPLATE_IDS).optional(),
  // Validation for active GST rate calculation type of this invoice (inclusive vs exclusive)
  gst_rate_type: z.enum(['inclusive', 'exclusive']).default('exclusive'),
  line_items: z
    .array(invoiceLineItemSchema)
    .min(1, 'Add at least one line item')
    .max(MAX_INVOICE_LINE_ITEMS, `Invoice cannot exceed ${MAX_INVOICE_LINE_ITEMS} line items`)
    .superRefine((items, ctx) => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item === undefined) continue;
        const qty = item.quantity;
        const rateRupees = item.unit_price;
        if (
          typeof qty === 'number' &&
          Number.isFinite(qty) &&
          typeof rateRupees === 'number' &&
          Number.isFinite(rateRupees)
        ) {
          const ratePaise = Math.round(rateRupees * 100);
          const grossPaise = Math.round(qty * ratePaise);
          if (grossPaise > MAX_LINE_GROSS_PAISE) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Line item gross amount cannot exceed ${MAX_AMOUNT_LABEL}`,
              path: [i, 'unit_price'],
            });
          }
        }
      }
    }),
});

export type InvoiceDraftInput = z.infer<typeof invoiceDraftSchema>;
export type InvoiceLineItemInput = z.infer<typeof invoiceLineItemSchema>;
