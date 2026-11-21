import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { NO_AUDIT_REQUEST_CONTEXT } from '@/lib/audit/log';
import * as schema from '@/lib/db/schema';
import { mapKnownDatabaseError } from '@/lib/actions/_shared/action-error-mapping';
import { FINALIZE_INVOICE_MAPPINGS } from '@/lib/actions/_shared/pg-constraint-mappings';
import { finalizeDraftInvoiceInTransaction } from '@/lib/invoices/finalize-invoice-tx';
import {
  TestDb,
  TestBusiness,
  getTestDatabaseUrl,
  validateTestDatabaseUrl,
  createTestDbClient,
  createTestBusiness,
  createTestDraftInvoice,
  cleanupTestBusiness,
} from './helpers/db';

/**
 * MONEY-01: when a number format prints an earlier invoice's number again, the business-wide unique key refuses it.
 * The real driver error must carry the constraint name so finalize maps it to DUPLICATE_INVOICE_NUMBER (a clear
 * message, not the generic error), and the rollback must leave both counters untouched.
 */
describe('MONEY-01: a repeated invoice number is refused and explained (REAL Postgres)', () => {
  let testDb: TestDb;
  let testBusiness: TestBusiness;

  beforeAll(async () => {
    testDb = createTestDbClient(validateTestDatabaseUrl(getTestDatabaseUrl()));
    testBusiness = await createTestBusiness(testDb);
  }, 60_000);

  afterAll(async () => {
    if (testDb && testBusiness) await cleanupTestBusiness(testDb, testBusiness.id);
  }, 60_000);

  const finalize = (invoiceId: string) =>
    testDb.transaction((tx) =>
      finalizeDraftInvoiceInTransaction(tx, {
        invoiceId,
        businessId: testBusiness.id,
        actorUserId: null,
        requestContext: NO_AUDIT_REQUEST_CONTEXT,
      }),
    );

  const counters = async () => {
    const [display] = await testDb
      .select({ value: sql<number>`coalesce(max(${schema.invoiceNumberCounters.counter_value}), 0)` })
      .from(schema.invoiceNumberCounters)
      .where(eq(schema.invoiceNumberCounters.business_id, testBusiness.id));
    const [audit] = await testDb
      .select({ value: sql<number>`coalesce(max(${schema.financialYears.invoice_sequence_counter}), 0)` })
      .from(schema.financialYears)
      .where(eq(schema.financialYears.business_id, testBusiness.id));
    return { display: Number(display?.value ?? 0), audit: Number(audit?.value ?? 0) };
  };

  it('maps the unique-key violation to DUPLICATE_INVOICE_NUMBER and rolls back every counter', async () => {
    const first = await createTestDraftInvoice(testDb, testBusiness.id);
    const issued = await finalize(first.invoiceId);
    expect(issued.invoiceId).toBe(first.invoiceId);

    // Simulate a format that repeats an earlier number: wind the display counter back one step.
    await testDb
      .update(schema.invoiceNumberCounters)
      .set({ counter_value: sql`${schema.invoiceNumberCounters.counter_value} - 1` })
      .where(eq(schema.invoiceNumberCounters.business_id, testBusiness.id));
    const before = await counters();

    const second = await createTestDraftInvoice(testDb, testBusiness.id);
    let caught: unknown;
    try {
      await finalize(second.invoiceId);
    } catch (error: unknown) {
      caught = error;
    }

    const mapped = mapKnownDatabaseError(caught, FINALIZE_INVOICE_MAPPINGS);
    expect(mapped?.code).toBe('DUPLICATE_INVOICE_NUMBER');
    expect(mapped?.message).toContain('{FY}');

    // Nothing was written: counters unchanged and the second invoice is still a draft.
    expect(await counters()).toEqual(before);
    const [row] = await testDb
      .select({ status: schema.invoices.lifecycle_status })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.id, second.invoiceId), eq(schema.invoices.business_id, testBusiness.id)));
    expect(row?.status).toBe('draft');
  }, 60_000);
});
