import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import { NO_AUDIT_REQUEST_CONTEXT } from '@/lib/audit/log';
import * as schema from '@/lib/db/schema';
import { setLocalLockTimeout, withTransactionRetry } from '@/lib/db/transaction';
import { lockBusinessRow } from '@/lib/actions/_shared/business-lock';
import { canAddCustomer, canAddProduct, getPlanEntitlements } from '@/lib/subscriptions/entitlements';
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

const testDbUrl = getTestDatabaseUrl();

function toCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Unexpected aggregate value');
  }
  return parsed;
}

describe.skipIf(!testDbUrl)('API-010: Concurrency serialization under business lock (REAL Postgres)', () => {
  let testDb: TestDb;
  let testBusiness: TestBusiness;
  let defaultFyId: string;

  beforeAll(async () => {
    const validUrl = validateTestDatabaseUrl(testDbUrl);
    testDb = createTestDbClient(validUrl);
    testBusiness = await createTestBusiness(testDb);

    // Warm up financial year
    const warmup = await createTestDraftInvoice(testDb, testBusiness.id);
    defaultFyId = warmup.financialYearId;
    await testDb.transaction((tx) =>
      finalizeDraftInvoiceInTransaction(tx, {
        invoiceId: warmup.invoiceId,
        businessId: testBusiness.id,
        actorUserId: null,
        requestContext: NO_AUDIT_REQUEST_CONTEXT,
      }),
    );

    // Ensure business is in free tier for quota tests
    await testDb
      .update(schema.businesses)
      .set({
        subscription_plan: 'free',
        subscription_status: 'expired',
        trial_ends_at: null,
      })
      .where(eq(schema.businesses.id, testBusiness.id));
  }, 60_000);

  afterAll(async () => {
    if (testDb && testBusiness) {
      await cleanupTestBusiness(testDb, testBusiness.id);
    }
  });

  it('AC-6: Parallel finalization of two DIFFERENT drafts at 29/30 yields exactly 1 success and 1 quota failure', async () => {
    // 1. Seed 28 additional finalized invoices (total = 29 including warmup) in current month
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 2; i <= 29; i++) {
      await testDb.insert(schema.invoices).values({
        business_id: testBusiness.id,
        financial_year_id: defaultFyId,
        invoice_number: `INV-29-${i}`,
        invoice_sequence: i,
        lifecycle_status: 'finalized',
        invoice_date: today,
        due_date: today,
        finalized_at: new Date(),
        subtotal_paise: 10000,
        total_tax_paise: 1800,
        grand_total_paise: 11800,
        archival_status: 'pending',
        seller_name_snapshot: 'Test Seller',
        seller_state_code_snapshot: '27',
        seller_snapshot_source: 'captured_at_finalization',
        seller_gstin_snapshot: testBusiness.gstin,
      });
    }

    // 2. Create two distinct drafts A and B
    const draftA = await createTestDraftInvoice(testDb, testBusiness.id);
    const draftB = await createTestDraftInvoice(testDb, testBusiness.id);

    // 3. Finalize draft A and draft B concurrently
    const [resA, resB] = await Promise.allSettled([
      withTransactionRetry(() =>
        testDb.transaction((tx) =>
          finalizeDraftInvoiceInTransaction(tx, {
            invoiceId: draftA.invoiceId,
            businessId: testBusiness.id,
            actorUserId: null,
            requestContext: NO_AUDIT_REQUEST_CONTEXT,
          }),
        ),
      ),
      withTransactionRetry(() =>
        testDb.transaction((tx) =>
          finalizeDraftInvoiceInTransaction(tx, {
            invoiceId: draftB.invoiceId,
            businessId: testBusiness.id,
            actorUserId: null,
            requestContext: NO_AUDIT_REQUEST_CONTEXT,
          }),
        ),
      ),
    ]);

    const successes = [resA, resB].filter((r) => r.status === 'fulfilled');
    const failures = [resA, resB].filter((r) => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const rejected = failures[0] as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ActionError);
    expect((rejected.reason as ActionError).code).toBe('INVOICE_QUOTA_EXCEEDED');
  });

  it('AC-6: Parallel creation of customers at 29/30 yields exactly 1 success and 1 quota failure', async () => {
    // Seed 29 customers
    for (let i = 1; i <= 29; i++) {
      await testDb.insert(schema.customers).values({
        business_id: testBusiness.id,
        name: `Customer Seed ${i}`,
        city: 'Mumbai',
        state_code: '27',
      });
    }

    // Attempt to insert customer 30 and 31 concurrently under business lock
    const insertCustomerUnderLock = async (name: string) => {
      return withTransactionRetry(() =>
        testDb.transaction(async (tx) => {
          await setLocalLockTimeout(tx);
          const business = await lockBusinessRow(tx, testBusiness.id);
          if (getPlanEntitlements(business).customerLimit !== null) {
            const [row] = await tx
              .select({ total: sql<string | number>`count(*)` })
              .from(schema.customers)
              .where(eq(schema.customers.business_id, testBusiness.id));
            const currentCount = toCount(row?.total);
            const quotaCheck = canAddCustomer(business, currentCount);
            if (!quotaCheck.allowed) {
              throw new ActionError(quotaCheck.reason ?? 'Customer quota exceeded.', {
                code: quotaCheck.code ?? 'CUSTOMER_QUOTA_EXCEEDED',
              });
            }
          }
          await tx.insert(schema.customers).values({
            business_id: testBusiness.id,
            name,
            city: 'Mumbai',
            state_code: '27',
          });
        }),
      );
    };

    const [resCust1, resCust2] = await Promise.allSettled([
      insertCustomerUnderLock('Concurrent Customer 1'),
      insertCustomerUnderLock('Concurrent Customer 2'),
    ]);

    const successes = [resCust1, resCust2].filter((r) => r.status === 'fulfilled');
    const failures = [resCust1, resCust2].filter((r) => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const rejected = failures[0] as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ActionError);
    expect((rejected.reason as ActionError).code).toBe('CUSTOMER_QUOTA_EXCEEDED');
  });

  it('AC-6: Parallel creation of products at 29/30 yields exactly 1 success and 1 quota failure', async () => {
    // Seed 29 products
    for (let i = 1; i <= 29; i++) {
      await testDb.insert(schema.products).values({
        business_id: testBusiness.id,
        name: `Product Seed ${i}`,
        hsn_sac_code: '998311',
        default_sale_price_paise: 10000,
      });
    }

    const insertProductUnderLock = async (name: string) => {
      return withTransactionRetry(() =>
        testDb.transaction(async (tx) => {
          await setLocalLockTimeout(tx);
          const business = await lockBusinessRow(tx, testBusiness.id);
          if (getPlanEntitlements(business).productLimit !== null) {
            const [row] = await tx
              .select({ total: sql<string | number>`count(*)` })
              .from(schema.products)
              .where(eq(schema.products.business_id, testBusiness.id));
            const currentCount = toCount(row?.total);
            const quotaCheck = canAddProduct(business, currentCount);
            if (!quotaCheck.allowed) {
              throw new ActionError(quotaCheck.reason ?? 'Product quota exceeded.', {
                code: quotaCheck.code ?? 'PRODUCT_QUOTA_EXCEEDED',
              });
            }
          }
          await tx.insert(schema.products).values({
            business_id: testBusiness.id,
            name,
            hsn_sac_code: '998311',
            default_sale_price_paise: 10000,
          });
        }),
      );
    };

    const [resProd1, resProd2] = await Promise.allSettled([
      insertProductUnderLock('Concurrent Product 1'),
      insertProductUnderLock('Concurrent Product 2'),
    ]);

    const successes = [resProd1, resProd2].filter((r) => r.status === 'fulfilled');
    const failures = [resProd1, resProd2].filter((r) => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const rejected = failures[0] as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ActionError);
    expect((rejected.reason as ActionError).code).toBe('PRODUCT_QUOTA_EXCEEDED');
  });
});

