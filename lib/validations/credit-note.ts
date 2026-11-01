import { z } from 'zod';
import { MAX_QUANTITY, MAX_INVOICE_LINE_ITEMS } from '@/lib/money-limits';

export const CREDIT_NOTE_REASONS = [
  { code: '01-sales-return', label: '01 - Sales Return' },
  { code: '02-post-sale-discount', label: '02 - Post-Sale Discount / Price Adjustment' },
  { code: '03-defective-goods', label: '03 - Defective / Damaged Goods' },
  { code: '04-cancellation', label: '04 - Order Cancellation / Correction' },
  { code: '05-other', label: '05 - Other Adjustment' },
] as const;

export const CREDIT_NOTE_REASON_CODES = [
  '01-sales-return',
  '02-post-sale-discount',
  '03-defective-goods',
  '04-cancellation',
  '05-other',
] as const;

export type CreditNoteReasonCode = (typeof CREDIT_NOTE_REASON_CODES)[number];

export function getCreditNoteReasonLabel(code: string): string {
  const found = CREDIT_NOTE_REASONS.find((r) => r.code === code);
  return found ? found.label : code;
}

export const creditNoteLineItemSchema = z
  .object({
    original_line_item_id: z.string().uuid('Select a valid invoice line to credit'),
    quantity: z
      .number()
      .positive('Quantity must be greater than 0')
      .max(MAX_QUANTITY, 'Quantity is too large'),
  })
  .strict(); // unit_price / discount / tax_rate_id / hsn / description are REJECTED, not ignored

export const creditNoteDraftSchema = z
  .object({
    id: z.string().uuid().optional(),
    original_invoice_id: z.string().uuid('Original invoice ID is required'),
    reason: z.enum(CREDIT_NOTE_REASON_CODES),
    issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format').optional(),
    notes: z.string().max(1000).optional().nullable().or(z.literal('')),
    line_items: z
      .array(creditNoteLineItemSchema)
      .min(1, 'Credit note must have at least one line item')
      .max(MAX_INVOICE_LINE_ITEMS, 'A credit note cannot have more than 200 lines')
      .superRefine((items, ctx) => {
        const seen = new Set<string>();
        items.forEach((item, index) => {
          if (seen.has(item.original_line_item_id)) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'original_line_item_id'],
              message: 'Each invoice line can only appear once.',
            });
          }
          seen.add(item.original_line_item_id);
        });
      }),
  })
  .strict();

export const finalizeCreditNoteSchema = z
  .object({
    id: z.string().uuid('Credit note ID is required'),
  })
  .strict();

export const VOID_CREDIT_NOTE_REASONS = [
  { id: 'clerical_error', label: 'Clerical Error in Amount / Items' },
  { id: 'wrong_recipient', label: 'Wrong Customer / Recipient Selected' },
  { id: 'duplicate_issue', label: 'Duplicate Credit Note Issued' },
  { id: 'cancelled_by_mutual_agreement', label: 'Cancelled by Mutual Customer Agreement' },
  { id: 'other', label: 'Other Statutory Reason' },
] as const;

export const voidCreditNoteSchema = z
  .object({
    id: z.string().uuid('Credit note ID is required'),
    reason: z.string().min(1, 'Please select a reason for voiding this credit note'),
    notes: z.string().max(500, 'Notes must be under 500 characters').optional().nullable(),
    confirm: z.boolean().refine((val) => val === true, 'You must acknowledge the cancellation'),
  })
  .strict();

export type CreditNoteDraftInput = z.infer<typeof creditNoteDraftSchema>;
export type CreditNoteLineItemInput = z.infer<typeof creditNoteLineItemSchema>;
export type VoidCreditNoteInput = z.infer<typeof voidCreditNoteSchema>;
