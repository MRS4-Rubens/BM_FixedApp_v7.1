import { z } from 'zod';
import { INDIAN_GST_STATES } from '@/lib/gst/indian-states';
import { GSTIN_REGEX } from '@/lib/validations/patterns';
import { legalBusinessNameSchema } from '@/lib/validations/business';

export const correctedGstinSchema = z.string().trim().toUpperCase()
  .regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN.')
  .refine((value) => INDIAN_GST_STATES.some(({ code }) => code === value.slice(0, 2)), {
    message: 'Enter a GSTIN with a valid registered state code.',
  });

export const adminUpdateBusinessIdentitySchema = z
  .object({
    business_id: z.string().uuid(),
    gstin: z.object({ previous: z.string().max(15), value: correctedGstinSchema }).strict().optional(),
    legal_name: z.object({ previous: z.string().max(200), value: legalBusinessNameSchema }).strict().optional(),
    reason: z
      .string()
      .trim()
      .min(10, 'Please give a reason of at least 10 characters.')
      .max(500),
  })
  .strict()
  .refine((d) => d.gstin !== undefined || d.legal_name !== undefined, {
    message: 'Select at least one field to correct.',
  });

export type AdminUpdateBusinessIdentityInput = z.infer<typeof adminUpdateBusinessIdentitySchema>;
