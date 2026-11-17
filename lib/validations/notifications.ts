import { z } from 'zod';
import { GST_FILING_FREQUENCIES } from '@/lib/db/domain-values';

/** Feature C: payloads of the notification actions. */

const MARK_READ_MAX_IDS = 50;

export const markNotificationsReadSchema = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1).max(MARK_READ_MAX_IDS) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

export const gstFilingFrequencySchema = z
  .object({ frequency: z.enum(GST_FILING_FREQUENCIES) })
  .strict();
