import { z } from 'zod';

export const requestAccountClosureSchema = z.object({
  confirmation_gstin: z
    .string()
    .trim()
    .transform((val) => val.toUpperCase()),
  reason: z
    .string()
    .max(500, 'Reason must not exceed 500 characters')
    .optional(),
});

export type RequestAccountClosureInput = z.infer<typeof requestAccountClosureSchema>;

