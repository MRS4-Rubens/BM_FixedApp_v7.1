import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { NO_AUDIT_REQUEST_CONTEXT } from '@/lib/audit/log';
import * as schema from '@/lib/db/schema';
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
import { makeValidGstin } from './helpers/fixtures';

/**
 * MONEY-02: picking a saved customer that has no GSTIN and typing the buyer's GSTIN on the draft must issue an
 * invoice WITH that GSTIN (as previewed) and the saved customer's address. Before the fix, finalize replaced it with
 * the customer record's empty GSTIN.
 */
describe('MONEY-02: finalize keeps the GSTIN shown on the draft (REAL Postgres)', () => {
  let testDb: TestDb;
  let testBusiness: TestBusiness;

  beforeAll(async () => {
    testDb = createTestDbClient(validateTestDatabaseUrl(getTestDatabaseUrl()));
    testBusiness = await createTestBusiness(testDb);
  }, 60_000);

  afterAll(async () => {
    if (testDb && testBusiness) await cleanupTestBusiness(testDb, testBusiness.id);
  }, 60_000);

  it('issues the typed GSTIN with the saved customer address', async () => {
    const [customer] = await testDb
      .insert(schema.customers)
      .values({
        business_id: testBusiness.id,
        name: 'Sharma Traders',
        gstin: null,
        address_line1: '12 MG Road',
        city: 'Pune',
        state_code: '27',
        pincode: '411001',
      })
      .returning({ id: schema.customers.id });
    if (!customer) throw new Error('customer not created');

    const typedGstin = makeValidGstin('27');
    const draft = await createTestDraftInvoice(testDb, testBusiness.id);
    await testDb
      .update(schema.invoices)
      .set({ customer_id: customer.id, billing_name_snapshot: 'Sharma Traders', billing_gstin_snapshot: typedGstin })
      .where(and(eq(schema.invoices.id, draft.invoiceId), eq(schema.invoices.business_id, testBusiness.id)));

    await testDb.transaction((tx) =>
      finalizeDraftInvoiceInTransaction(tx, {
        invoiceId: draft.invoiceId,
        businessId: testBusiness.id,
        actorUserId: null,
        requestContext: NO_AUDIT_REQUEST_CONTEXT,
      }),
    );

    const [issued] = await testDb
      .select({
        status: schema.invoices.lifecycle_status,
        name: schema.invoices.billing_name_snapshot,
        gstin: schema.invoices.billing_gstin_snapshot,
        address: schema.invoices.billing_address_snapshot,
      })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.id, draft.invoiceId), eq(schema.invoices.business_id, testBusiness.id)));

    expect(issued).toEqual({
      status: 'finalized',
      name: 'Sharma Traders',
      gstin: typedGstin,
      address: '12 MG Road\nPune, 27, 411001',
    });
  }, 60_000);
});
