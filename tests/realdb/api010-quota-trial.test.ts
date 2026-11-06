import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { NO_AUDIT_REQUEST_CONTEXT } from '@/lib/audit/log';
import { finalizeDraftInvoiceInTransaction } from '@/lib/invoices/finalize-invoice-tx';
import { FREE_TIER_LIMITS } from '@/lib/subscriptions/entitlements';
import {
  type TestDb,
  getTestDatabaseUrl,
  validateTestDatabaseUrl,
  createTestDbClient,
  closeTestDb,
  createTestDraftInvoice,
} from './helpers/db';
import {
  harnessState,
  resetLoggedErrors,
  runAs,
  type HarnessUser,
} from './helpers/harness';
import {
  createFreePlanBusiness,
  createTestUser,
} from './helpers/fixtures';
import { runConcurrently, countFulfilled } from './helpers/concurrency';

vi.mock('@/lib/db/client', async () => (await import('./helpers/harness')).dbClientModule());
vi.mock('@/lib/auth/session', async () => (await import('./helpers/harness')).sessionModule());
vi.mock('@/lib/auth/server', async () => (await import('./helpers/harness')).authServerModule());
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));
vi.mock('@/lib/rate-limit/upstash', async () => (await import('./helpers/harness')).rateLimitModule());
vi.mock('@/lib/actions/_shared/logger', async () => (await import('./helpers/harness')).loggerModule());
vi.mock('@/lib/storage/idrive', async () => (await import('./helpers/harness')).storageModule());
vi.mock('@/lib/storage/archive-invoice', () => ({
  archiveInvoicePdf: async () => ({ status: 'archived', storageKey: 'k' }),
}));
vi.mock('@/lib/storage/archive-credit-note', () => ({
  archiveCreditNotePdf: async () => ({ status: 'archived', storageKey: 'k' }),
}));
// finalizeInvoice schedules archival with next/server after(), which only works inside a real request scope.
vi.mock('@/lib/storage/schedule-archival', () => ({ scheduleArchival: () => undefined }));
vi.mock('@/lib/email/resend', async () => (await import('./helpers/harness')).emailModule());
vi.mock('@/lib/env', async () => (await import('./helpers/harness')).envModule());

import { finalizeInvoice } from '@/lib/actions/invoices/finalize-invoice';
import { createCustomer } from '@/lib/actions/customers/create-customer';
import { createProduct } from '@/lib/actions/products/create-product';

describe('API-010: Quota & Trial Concurrency Invariants (REAL Postgres)', () => {
  let testDb: TestDb;
  const createdBusinessIds: string[] = [];

  beforeAll(async () => {
    const url = validateTestDatabaseUrl(getTestDatabaseUrl());
    testDb = createTestDbClient(url);
    harnessState.db = testDb;
  });

  afterAll(async () => {
    if (!testDb) return;
    for (const bizId of createdBusinessIds) {
      await testDb.delete(schema.invoiceLineItems).where(
        sql`${schema.invoiceLineItems.invoice_id} IN (SELECT id FROM invoices WHERE business_id = ${bizId})`,
      ).catch(() => undefined);
      await testDb.delete(schema.invoices).where(eq(schema.invoices.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.customers).where(eq(schema.customers.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.products).where(eq(schema.products.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.auditLog).where(eq(schema.auditLog.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.users).where(eq(schema.users.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.businesses).where(eq(schema.businesses.id, bizId)).catch(() => undefined);
    }
    await closeTestDb(testDb);
  });

  beforeEach(() => {
    resetLoggedErrors();
  });

  it('1. Finalize quota race: free plan at (limit - 1); 5 concurrent finalizes => exactly 1 success, 4 INVOICE_QUOTA_EXCEEDED, count == limit', async () => {
    const limit = FREE_TIER_LIMITS.invoiceMonthlyLimit;
    expect(limit).toBe(30);

    const biz = await createFreePlanBusiness(testDb);
    createdBusinessIds.push(biz.id);

    const owner = await createTestUser(testDb, {
      email: `quota-owner-${randomUUID()}@example.com`,
      businessId: biz.id,
    });

    const user: HarnessUser = {
      id: owner.id,
      email: owner.email,
      businessId: biz.id,
      role: 'owner',
    };

    // Fast-path: pre-populate (limit - 1) finalized invoices using the transaction engine
    for (let i = 0; i < limit - 1; i += 1) {
      const draft = await createTestDraftInvoice(testDb, biz.id);
      await testDb.transaction((tx) =>
        finalizeDraftInvoiceInTransaction(tx, {
          invoiceId: draft.invoiceId,
          businessId: biz.id,
          actorUserId: owner.id,
          requestContext: NO_AUDIT_REQUEST_CONTEXT,
        }),
      );
    }

    // Verify exactly (limit - 1) finalized
    const [preCount] = await testDb
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.invoices)
      .where(
        sql`${schema.invoices.business_id} = ${biz.id} AND ${schema.invoices.lifecycle_status} = 'finalized'`,
      );
    expect(preCount.count).toBe(limit - 1);

    // Create 5 separate draft invoices to race
    const raceDrafts: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const d = await createTestDraftInvoice(testDb, biz.id);
      raceDrafts.push(d.invoiceId);
    }

    // Fire 5 concurrent finalize actions
    const results = await runConcurrently(5, (index) =>
      runAs(user, () => finalizeInvoice({ id: raceDrafts[index] })),
    );

    expect(results).toHaveLength(5);
    expect(countFulfilled(results)).toBe(5);

    const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    const successes = outcomes.filter((o) => o?.success === true);
    const failures = outcomes.filter((o) => o?.success === false);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(4);

    for (const fail of failures) {
      if (fail && !fail.success) {
        expect(fail.error.code).toBe('INVOICE_QUOTA_EXCEEDED');
      }
    }

    // Verify final count is EXACTLY limit (30), never limit + 1
    const [postCount] = await testDb
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.invoices)
      .where(
        sql`${schema.invoices.business_id} = ${biz.id} AND ${schema.invoices.lifecycle_status} = 'finalized'`,
      );
    expect(postCount.count).toBe(limit);
  });

  it('2. Trial & Suspension evaluations: past trial_ends_at, null trial_ends_at, active trial, suspended status', async () => {
    // 2a. Suspended account: blocked on draft save and finalize
    const [suspendedBiz] = await testDb
      .insert(schema.businesses)
      .values({
        legal_name: 'Suspended Corp',
        gstin: '27AAAAA0000A1Z5',
        address_line1: '123 Street',
        city: 'Mumbai',
        state_code: '27',
        pincode: '400001',
        subscription_plan: 'essentials',
        subscription_status: 'suspended',
      })
      .returning();
    createdBusinessIds.push(suspendedBiz.id);

    const suspendedOwner = await createTestUser(testDb, {
      email: `suspended-${randomUUID()}@example.com`,
      businessId: suspendedBiz.id,
    });
    const suspendedUser: HarnessUser = {
      id: suspendedOwner.id,
      email: suspendedOwner.email,
      businessId: suspendedBiz.id,
      role: 'owner',
    };

    const draft = await createTestDraftInvoice(testDb, suspendedBiz.id);

    const suspendedFinalize = await runAs(suspendedUser, () =>
      finalizeInvoice({ id: draft.invoiceId }),
    );
    expect(suspendedFinalize.success).toBe(false);
    if (!suspendedFinalize.success) {
      expect(suspendedFinalize.error.code).toBe('ACCOUNT_SUSPENDED');
    }

    // 2b. Expired trial (trial_ends_at in the past) with 30 finalized invoices: finalize blocked
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [expiredTrialBiz] = await testDb
      .insert(schema.businesses)
      .values({
        legal_name: 'Expired Trial Corp',
        gstin: '27BBBBB0000B1Z4',
        address_line1: '123 Street',
        city: 'Mumbai',
        state_code: '27',
        pincode: '400001',
        subscription_plan: 'trial',
        subscription_status: 'trial',
        trial_ends_at: pastDate,
      })
      .returning();
    createdBusinessIds.push(expiredTrialBiz.id);

    const expiredOwner = await createTestUser(testDb, {
      email: `expired-trial-${randomUUID()}@example.com`,
      businessId: expiredTrialBiz.id,
    });
    const expiredUser: HarnessUser = {
      id: expiredOwner.id,
      email: expiredOwner.email,
      businessId: expiredTrialBiz.id,
      role: 'owner',
    };

    // Pre-populate 30 invoices (free tier limit)
    for (let i = 0; i < 30; i += 1) {
      const d = await createTestDraftInvoice(testDb, expiredTrialBiz.id);
      await testDb.transaction((tx) =>
        finalizeDraftInvoiceInTransaction(tx, {
          invoiceId: d.invoiceId,
          businessId: expiredTrialBiz.id,
          actorUserId: expiredOwner.id,
          requestContext: NO_AUDIT_REQUEST_CONTEXT,
        }),
      );
    }

    const overDraft = await createTestDraftInvoice(testDb, expiredTrialBiz.id);
    const expiredTrialFinalize = await runAs(expiredUser, () =>
      finalizeInvoice({ id: overDraft.invoiceId }),
    );
    expect(expiredTrialFinalize.success).toBe(false);
    if (!expiredTrialFinalize.success) {
      expect(expiredTrialFinalize.error.code).toBe('INVOICE_QUOTA_EXCEEDED');
    }

    // 2c. Active trial (trial_ends_at in future): allows 30+ invoices without limit
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const [activeTrialBiz] = await testDb
      .insert(schema.businesses)
      .values({
        legal_name: 'Active Trial Corp',
        gstin: '27CCCCC0000C1Z3',
        address_line1: '123 Street',
        city: 'Mumbai',
        state_code: '27',
        pincode: '400001',
        subscription_plan: 'trial',
        subscription_status: 'trial',
        trial_ends_at: futureDate,
      })
      .returning();
    createdBusinessIds.push(activeTrialBiz.id);

    const activeTrialOwner = await createTestUser(testDb, {
      email: `active-trial-${randomUUID()}@example.com`,
      businessId: activeTrialBiz.id,
    });
    const activeTrialUser: HarnessUser = {
      id: activeTrialOwner.id,
      email: activeTrialOwner.email,
      businessId: activeTrialBiz.id,
      role: 'owner',
    };

    // Populate 30 invoices
    for (let i = 0; i < 30; i += 1) {
      const d = await createTestDraftInvoice(testDb, activeTrialBiz.id);
      await testDb.transaction((tx) =>
        finalizeDraftInvoiceInTransaction(tx, {
          invoiceId: d.invoiceId,
          businessId: activeTrialBiz.id,
          actorUserId: activeTrialOwner.id,
          requestContext: NO_AUDIT_REQUEST_CONTEXT,
        }),
      );
    }

    // 31st invoice is allowed because active trial has unlimited invoices
    const invoice31 = await createTestDraftInvoice(testDb, activeTrialBiz.id);
    const activeTrialFinalize = await runAs(activeTrialUser, () =>
      finalizeInvoice({ id: invoice31.invoiceId }),
    );
    expect(activeTrialFinalize.success).toBe(true);

    // 2d. Paid plan ('essentials') is unaffected by 30+ invoices
    const [paidBiz] = await testDb
      .insert(schema.businesses)
      .values({
        legal_name: 'Paid Corp',
        gstin: '27DDDDD0000D1Z2',
        address_line1: '123 Street',
        city: 'Mumbai',
        state_code: '27',
        pincode: '400001',
        subscription_plan: 'essentials',
        subscription_status: 'active',
        subscription_ends_at: futureDate,
      })
      .returning();
    createdBusinessIds.push(paidBiz.id);

    const paidOwner = await createTestUser(testDb, {
      email: `paid-${randomUUID()}@example.com`,
      businessId: paidBiz.id,
    });
    const paidUser: HarnessUser = {
      id: paidOwner.id,
      email: paidOwner.email,
      businessId: paidBiz.id,
      role: 'owner',
    };

    for (let i = 0; i < 30; i += 1) {
      const d = await createTestDraftInvoice(testDb, paidBiz.id);
      await testDb.transaction((tx) =>
        finalizeDraftInvoiceInTransaction(tx, {
          invoiceId: d.invoiceId,
          businessId: paidBiz.id,
          actorUserId: paidOwner.id,
          requestContext: NO_AUDIT_REQUEST_CONTEXT,
        }),
      );
    }

    const paid31 = await createTestDraftInvoice(testDb, paidBiz.id);
    const paidFinalize = await runAs(paidUser, () =>
      finalizeInvoice({ id: paid31.invoiceId }),
    );
    expect(paidFinalize.success).toBe(true);
  });

  it('3. Customer and product quota concurrency: parallel creates at (limit - 1) never exceed limit', async () => {
    const custLimit = FREE_TIER_LIMITS.customerLimit;
    const prodLimit = FREE_TIER_LIMITS.productLimit;
    expect(custLimit).toBe(30);
    expect(prodLimit).toBe(30);

    const biz = await createFreePlanBusiness(testDb);
    createdBusinessIds.push(biz.id);

    const owner = await createTestUser(testDb, {
      email: `limits-owner-${randomUUID()}@example.com`,
      businessId: biz.id,
    });

    const user: HarnessUser = {
      id: owner.id,
      email: owner.email,
      businessId: biz.id,
      role: 'owner',
    };

    // 3a. Pre-populate 29 customers
    for (let i = 0; i < custLimit - 1; i += 1) {
      await testDb.insert(schema.customers).values({
        business_id: biz.id,
        name: `Pre-Customer ${i}`,
        state_code: '27',
      });
    }

    // Run 5 concurrent createCustomer calls
    const custResults = await runConcurrently(5, (index) =>
      runAs(user, () =>
        createCustomer({
          name: `Concurrent Customer ${index}`,
          state_code: '27',
        }),
      ),
    );

    const custOutcomes = custResults.map((r) => (r.status === 'fulfilled' ? r.value : null));
    const custSuccesses = custOutcomes.filter((o) => o?.success === true);
    const custFailures = custOutcomes.filter((o) => o?.success === false);

    expect(custSuccesses).toHaveLength(1);
    expect(custFailures).toHaveLength(4);

    for (const fail of custFailures) {
      if (fail && !fail.success) {
        expect(fail.error.code).toBe('CUSTOMER_QUOTA_EXCEEDED');
      }
    }

    const [finalCustCount] = await testDb
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.customers)
      .where(eq(schema.customers.business_id, biz.id));
    expect(finalCustCount.count).toBe(custLimit);

    // 3b. Pre-populate 29 products
    for (let i = 0; i < prodLimit - 1; i += 1) {
      await testDb.insert(schema.products).values({
        business_id: biz.id,
        name: `Pre-Product ${i}`,
        hsn_sac_code: '1234',
        unit_of_measurement: 'NOS',
        default_sale_price_paise: 10000,
      });
    }

    // Run 5 concurrent createProduct calls
    const prodResults = await runConcurrently(5, (index) =>
      runAs(user, () =>
        createProduct({
          name: `Concurrent Product ${index}`,
          hsn_sac_code: '1234',
          unit_of_measurement: 'NOS',
          default_sale_price: 100,
        }),
      ),
    );

    const prodOutcomes = prodResults.map((r) => (r.status === 'fulfilled' ? r.value : null));
    const prodSuccesses = prodOutcomes.filter((o) => o?.success === true);
    const prodFailures = prodOutcomes.filter((o) => o?.success === false);

    expect(prodSuccesses).toHaveLength(1);
    expect(prodFailures).toHaveLength(4);

    for (const fail of prodFailures) {
      if (fail && !fail.success) {
        expect(fail.error.code).toBe('PRODUCT_QUOTA_EXCEEDED');
      }
    }

    const [finalProdCount] = await testDb
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.products)
      .where(eq(schema.products.business_id, biz.id));
    expect(finalProdCount.count).toBe(prodLimit);
  });
});
