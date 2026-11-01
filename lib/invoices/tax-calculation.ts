import { ActionError } from '@/lib/actions/_shared/errors';
import { calculateInvoiceTax } from '@/lib/gst/calculate';
import { MoneyLimitError } from '@/lib/gst/errors';
import type { TaxCalculationInput, TaxCalculationResult } from '@/lib/gst/types';

/**
 * Server-action boundary around the pure GST engine. Business-ceiling violations become a user-visible
 * ActionError; every other failure propagates untouched and is treated as unexpected by the action wrapper.
 */
export function calculateInvoiceTaxOrActionError(input: TaxCalculationInput): TaxCalculationResult {
  try {
    return calculateInvoiceTax(input);
  } catch (error) {
    if (error instanceof MoneyLimitError) {
      throw new ActionError(error.message, { code: 'AMOUNT_LIMIT_EXCEEDED' });
    }
    throw error;
  }
}

