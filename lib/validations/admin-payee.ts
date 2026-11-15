import { z } from 'zod';
import {
  UPI_ID_PATTERN,
  IFSC_PATTERN,
  ACCOUNT_NUMBER_PATTERN,
  DISPLAY_TEXT_PATTERN,
} from '@/lib/config/payee';

export const updatePlatformPayeeSchema = z.object({
  upiId: z.string().trim().regex(UPI_ID_PATTERN, 'Invalid UPI ID format (e.g. name@bank)'),
  upiName: z.string().trim().regex(DISPLAY_TEXT_PATTERN, 'Recipient display name must be between 2 and 100 characters'),
  bankName: z.string().trim().regex(DISPLAY_TEXT_PATTERN, 'Bank name must be between 2 and 100 characters'),
  accName: z.string().trim().regex(DISPLAY_TEXT_PATTERN, 'Account name must be between 2 and 100 characters'),
  accNo: z.string().trim().regex(ACCOUNT_NUMBER_PATTERN, 'Account number must be 9 to 18 digits'),
  ifsc: z.string().trim().toUpperCase().regex(IFSC_PATTERN, 'Invalid IFSC code format (e.g. SBIN0000952)'),
});

export type UpdatePlatformPayeeInput = z.infer<typeof updatePlatformPayeeSchema>;
