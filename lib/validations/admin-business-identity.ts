import { z } from 'zod';
import { INDIAN_GST_STATES } from '@/lib/gst/indian-states';
import { GSTIN_REGEX } from '@/lib/validations/patterns';

/** Input for the platform-admin GSTIN/state correction action (AUTH-004). */
export const adminUpdateBusinessIdentitySchema = z
  .object({
    business_id: z.string().uuid(),
    gstin: z
      .string()
      .transform((v) => v.toUpperCase())
      .pipe(z.string().regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN')),
    state_code: z.string().length(2),
    reason: z
      .string()
      .trim()
      .min(10, 'Please give a reason of at least 10 characters.')
      .max(500),
  })
  .strict()
  .refine((d) => INDIAN_GST_STATES.some((s) => s.code === d.state_code), {
    message: 'Select a valid state',
    path: ['state_code'],
  })
  .refine((d) => d.gstin.slice(0, 2) === d.state_code, {
    message: "The GSTIN's state code does not match the selected state",
    path: ['gstin'],
  });

export type AdminUpdateBusinessIdentityInput = z.infer<typeof adminUpdateBusinessIdentitySchema>;
