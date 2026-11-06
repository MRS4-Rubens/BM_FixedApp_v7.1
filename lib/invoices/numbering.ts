import { sql, eq, and } from 'drizzle-orm';
import { financialYears, invoiceNumberCounters } from '@/lib/db/schema';
import { getResetGranularity, getPeriodKey, resolveInvoiceNumber } from './number-format';
import { ActionError } from '@/lib/actions/_shared/errors';
import type { DbTransaction } from '@/lib/db/client';

/**
 * MUST only be called inside a transaction in which the caller already holds
 * the document row lock (see lib/invoices/document-locks.ts); the counter UPDATE
 * serialises concurrent finalizations of different documents on the financial_years
 * row and is rolled back with the transaction, which is what keeps the series gap-free.
 */
export async function getNextInvoiceNumber(
  tx: DbTransaction,
  params: {
    businessId: string;
    financialYearId: string;
    fyLabel: string;
    invoiceNumberFormat: string;
    invoiceDate: Date;
  }
): Promise<{ invoiceNumber: string; absoluteSequence: number }> {
  const { businessId, financialYearId, fyLabel, invoiceNumberFormat, invoiceDate } = params;

  // 1. Atomically increment the permanent audit sequence
  const updatedFy = await tx.update(financialYears)
    .set({ invoice_sequence_counter: sql`${financialYears.invoice_sequence_counter} + 1` })
    .where(and(eq(financialYears.id, financialYearId), eq(financialYears.business_id, businessId)))
    .returning({ invoice_sequence_counter: financialYears.invoice_sequence_counter });

  if (!updatedFy || updatedFy.length === 0) {
    throw new ActionError('Failed to increment financial year sequence counter.', { code: 'SEQUENCE_ERROR' });
  }

  const absoluteSequence = updatedFy[0].invoice_sequence_counter;

  // 2. Determine granularity
  const granularity = getResetGranularity(invoiceNumberFormat);

  // 3. Compute periodKey
  const periodKey = getPeriodKey(granularity, financialYearId, invoiceDate);

  // 4. Atomically upsert-and-increment the display counter
  const upsertedCounter = await tx.insert(invoiceNumberCounters)
    .values({
      business_id: businessId,
      period_key: periodKey,
      counter_value: 1
    })
    .onConflictDoUpdate({
      target: [invoiceNumberCounters.business_id, invoiceNumberCounters.period_key],
      set: { counter_value: sql`${invoiceNumberCounters.counter_value} + 1` }
    })
    .returning({ counter_value: invoiceNumberCounters.counter_value });

  if (!upsertedCounter || upsertedCounter.length === 0) {
    throw new ActionError('Failed to generate invoice number sequence.', { code: 'SEQUENCE_ERROR' });
  }

  const sequenceValue = upsertedCounter[0].counter_value;

  // 5. Call resolveInvoiceNumber
  const invoiceNumber = resolveInvoiceNumber(invoiceNumberFormat, {
    invoiceDate,
    fyLabel,
    sequenceValue
  });

  // 6. Re-validate the final string's length
  if (invoiceNumber.length > 16) {
    throw new ActionError("Today's invoice count has exceeded your configured numbering format's capacity, which would produce a non-compliant invoice number. Please shorten your invoice number format or increase its counter width in Settings before continuing.", { code: 'FORMAT_CAPACITY_EXCEEDED' });
  }

  // 7. Return
  return { invoiceNumber, absoluteSequence };
}
