import { z } from 'zod';
import { isValidIsoDate } from '@/lib/invoices/ist-date';
import { parseRupeesToPaise } from '@/lib/money';

export const MAX_PAYMENT_RUPEES = 99_999_999.99; // sanity bound only; the overpayment rule is the real bound

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date (YYYY-MM-DD)')
  .refine(isValidIsoDate, 'Enter a valid calendar date');

export const recordPaymentSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: z.coerce
    .number({ error: 'Enter a valid amount' })
    .min(0.01, 'Amount must be at least ₹0.01')
    .max(MAX_PAYMENT_RUPEES, 'Amount is too large')
    .refine((value) => parseRupeesToPaise(value) !== null, 'Amount can have at most 2 decimal places'),
  payment_date: isoDate,
  payment_method: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other']),
  reference_number: z.string().max(100).optional().or(z.literal('')),
  notes: z.string().max(500).optional().or(z.literal('')),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const VOID_PAYMENT_REASONS = [
  { code: 'bounced_cheque', label: 'Bounced Cheque / Failed Bank Transfer' },
  { code: 'clerical_error', label: 'Clerical / Data Entry Mistake' },
  { code: 'wrong_invoice', label: 'Recorded on Wrong Invoice' },
  { code: 'customer_dispute', label: 'Customer Dispute / Reversal' },
  { code: 'chargeback_refund', label: 'Customer Refund / Chargeback' },
  { code: 'other', label: 'Other (Reason specified in notes)' },
] as const;

export type VoidPaymentReasonCode = typeof VOID_PAYMENT_REASONS[number]['code'];

export const voidPaymentSchema = z.object({
  id: z.string().uuid('Invalid payment ID'),
  reason: z.enum([
    'bounced_cheque',
    'clerical_error',
    'wrong_invoice',
    'customer_dispute',
    'chargeback_refund',
    'other',
  ]),
  notes: z.string().min(3, 'Please provide an explanation (min 3 characters)').max(300),
});

export type VoidPaymentInput = z.infer<typeof voidPaymentSchema>;
