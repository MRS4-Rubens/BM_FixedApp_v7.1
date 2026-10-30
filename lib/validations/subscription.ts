import { z } from 'zod';
import { maxBase64Chars } from '@/lib/security/upload';

export const subscriptionClaimSchema = z.object({
  plan_name: z.enum(['essentials', 'professional'], {
    message: 'Invalid subscription plan selected.',
  }),
  billing_cycle: z.enum(['monthly', 'yearly'], {
    message: 'Invalid billing cycle.',
  }),
  amount_paise: z.number().int().positive('Amount must be positive').optional(),
  payment_method: z.enum(['upi_qr', 'upi_id', 'bank_transfer']),
  payment_reference: z.string()
    .min(6, 'Transaction reference/UTR must be at least 6 characters')
    .max(50, 'Transaction reference/UTR is too long')
    .regex(/^[A-Za-z0-9/-]+$/, 'Reference can only contain letters, numbers, / and -')
    .transform((val) => val.trim().toUpperCase()),
  screenshot_base64: z.string().max(maxBase64Chars(4 * 1024 * 1024)).optional().or(z.literal('')),
  // client hint, ignored by the server
  screenshot_mime: z.string().max(100).optional().or(z.literal('')),
});

export type SubscriptionClaimInput = z.infer<typeof subscriptionClaimSchema>;
