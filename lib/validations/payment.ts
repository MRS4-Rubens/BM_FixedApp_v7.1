import { z } from 'zod';
import { parseRupeesToPaise } from '@/lib/money';
import { isoDate } from '@/lib/validations/common';

const MAX_PAYMENT_RUPEES = 99_999_999.99; // sanity bound only; the overpayment rule is the real bound

export const recordPaymentSchema = z.object({
  invoice_id: z.string().uuid(),
  // REFUND: 'refund' records money paid BACK to the customer (only while a refund is due). Same fields as a payment.
  // Optional: missing => 'payment', so every existing caller is unchanged.
  kind: z.enum(['payment', 'refund']).optional(),
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
  // Code kept for history. A real refund is now RECORDED as a refund; voiding erases the receipt itself.
  { code: 'chargeback_refund', label: 'Card Chargeback / Bank Reversal' },
  { code: 'refund_failed', label: 'Refund Failed / Returned to Us' },
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
    'refund_failed',
    'other',
  ]),
  notes: z.string().min(3, 'Please provide an explanation (min 3 characters)').max(300),
});

export type VoidPaymentInput = z.infer<typeof voidPaymentSchema>;
