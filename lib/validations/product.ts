import { z } from 'zod';
import { UNIT_OF_MEASUREMENT_OPTIONS } from '../gst/units';
import { MAX_UNIT_PRICE_RUPEES } from '@/lib/validations/limits';
import { MAX_UNIT_PRICE_LABEL } from '@/lib/money-limits';
import { moneyRupees } from '@/lib/validations/common';

export const productSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name must be 200 characters or less'),
  description: z.string().max(1000, 'Description must be 1000 characters or less').optional().or(z.literal('')),
  hsn_sac_code: z.string()
    .trim()
    .max(8)
    .regex(/^(\d{4}|\d{6}|\d{8})$/, 'Enter a valid 4, 6, or 8-digit HSN/SAC code.'),
  unit_of_measurement: z.enum(UNIT_OF_MEASUREMENT_OPTIONS, {
    message: 'Please select a valid unit of measurement.',
  }),
  default_sale_price: moneyRupees({
    label: 'Price',
    max: MAX_UNIT_PRICE_RUPEES,
    maxMessage: `Price cannot exceed ${MAX_UNIT_PRICE_LABEL}`,
  }),
  default_tax_rate_id: z.string().uuid().optional().or(z.literal('')),
  stock_quantity: z.coerce.number().int('Stock must be a whole number').min(0, 'Stock cannot be negative').optional().or(z.literal('')),
});

export type ProductInput = z.infer<typeof productSchema>;
