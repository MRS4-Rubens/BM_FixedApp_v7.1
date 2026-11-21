import { z } from 'zod';
import { maxBase64Chars, PAYMENT_SCREENSHOT_MAX_BYTES } from '@/lib/security/upload-limits';
import { PAID_PLAN_NAMES, CLAIM_BILLING_CYCLES, CLAIM_PAYMENT_METHODS } from '@/lib/db/domain-values';

export const subscriptionClaimSchema = z.object({
  plan_name: z.enum(PAID_PLAN_NAMES, {
    message: 'Invalid subscription plan selected.',
  }),
  billing_cycle: z.enum(CLAIM_BILLING_CYCLES, {
    message: 'Invalid billing cycle.',
  }),
  amount_paise: z.number().int().positive('Amount must be positive').optional(),
  payment_method: z.enum(CLAIM_PAYMENT_METHODS),
  payment_reference: z.string()
    .min(6, 'Transaction reference/UTR must be at least 6 characters')
    .max(50, 'Transaction reference/UTR is too long')
    .regex(/^[A-Za-z0-9/-]+$/, 'Reference can only contain letters, numbers, / and -')
    .transform((val) => val.trim().toUpperCase()),
  screenshot_base64: z.string().max(maxBase64Chars(PAYMENT_SCREENSHOT_MAX_BYTES)).optional().or(z.literal('')),
  // client hint, ignored by the server
  screenshot_mime: z.string().max(100).optional().or(z.literal('')),
});

export type SubscriptionClaimInput = z.infer<typeof subscriptionClaimSchema>;
