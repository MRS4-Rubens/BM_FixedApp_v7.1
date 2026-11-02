import { z } from 'zod';
import { MAX_QUANTITY, MAX_LINE_ITEMS } from '@/lib/validations/limits';
import { hasValidQuantityPrecision, isoDate } from '@/lib/validations/common';

export const CREDIT_NOTE_REASONS = [
  { code: '01-sales-return', label: '01 - Sales Return' },
  { code: '02-post-sale-discount', label: '02 - Post Sale Discount' },
  { code: '03-deficiency-in-service', label: '03 - Deficiency in Services' },
  { code: '04-correction-in-invoice', label: '04 - Correction in Invoice' },
  { code: '05-change-in-pos', label: '05 - Change in POS' },
  { code: '06-finalization-of-provisional-assessment', label: '06 - Finalization of Provisional Assessment' },
  { code: '07-others', label: '07 - Others' },
] as const;

export const CREDIT_NOTE_REASON_CODES = [
  '01-sales-return',
  '02-post-sale-discount',
  '03-deficiency-in-service',
  '04-correction-in-invoice',
  '05-change-in-pos',
  '06-finalization-of-provisional-assessment',
  '07-others',
] as const;

export type CreditNoteReasonCode = (typeof CREDIT_NOTE_REASON_CODES)[number];

export function getCreditNoteReasonLabel(code: string): string {
  const found = CREDIT_NOTE_REASONS.find((r) => r.code === code);
  return found ? found.label : code;
}

export const creditNoteLineItemSchema = z
  .object({
    original_line_item_id: z.string().uuid('Original line item ID is required'),
    quantity: z
      .number()
      .positive('Quantity must be greater than 0')
      .max(MAX_QUANTITY, 'Quantity is too large')
      .refine(hasValidQuantityPrecision, 'Quantity can have at most 3 decimal places'),
  })
  .strict(); // unit_price / discount / tax_rate_id / hsn / description are REJECTED, not ignored

export const creditNoteDraftSchema = z
  .object({
    id: z.string().uuid().optional(),
    original_invoice_id: z.string().uuid('Original invoice ID is required'),
    reason: z.enum(CREDIT_NOTE_REASON_CODES),
    issue_date: isoDate.optional(),
    notes: z.string().max(1000).optional().nullable().or(z.literal('')),
    line_items: z
      .array(creditNoteLineItemSchema)
      .min(1, 'Credit note must have at least one line item')
      .max(MAX_LINE_ITEMS, `A credit note cannot have more than ${MAX_LINE_ITEMS} lines`)
      .superRefine((items, ctx) => {
        const seen = new Set<string>();
        items.forEach((item, index) => {
          if (seen.has(item.original_line_item_id)) {
            ctx.addIssue({
              code: 'custom',
              message: 'Each invoice line item can only appear once in a credit note',
              path: [index, 'original_line_item_id'],
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
