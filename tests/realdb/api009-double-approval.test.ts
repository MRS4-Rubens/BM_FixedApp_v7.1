import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { addBillingCycleUtc } from '@/lib/subscriptions/billing-period';
import {
  type TestDb,
  getTestDatabaseUrl,
  validateTestDatabaseUrl,
  createTestDbClient,
  closeTestDb,
} from './helpers/db';
import {
  harnessState,
  unexpectedLoggedErrors,
  resetLoggedErrors,
  runAs,
  type HarnessUser,
} from './helpers/harness';
import {
  createPendingClaim,
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
vi.mock('@/lib/email/mailer', async () => (await import('./helpers/harness')).emailModule());
vi.mock('@/lib/env', async () => (await import('./helpers/harness')).envModule());

import { processSubscriptionClaim } from '@/lib/actions/subscriptions/process-request';
import { submitPaymentClaim } from '@/lib/actions/subscriptions/submit-payment-claim';

describe('API-009: Double Approval & Claim Concurrency (REAL Postgres)', () => {
  let testDb: TestDb;
  const createdBusinessIds: string[] = [];

  const adminUser: HarnessUser = {
    id: 'a0000000-0000-4000-8000-000000000099',
    email: 'admin@test.dev',
    businessId: null,
    role: 'owner',
  };

  beforeAll(async () => {
    const url = validateTestDatabaseUrl(getTestDatabaseUrl());
    testDb = createTestDbClient(url);
    harnessState.db = testDb;

    // Ensure platform admin user exists in DB for foreign keys
    await testDb
      .insert(schema.users)
      .values({
        id: adminUser.id,
        auth_user_id: 'auth_admin_api009',
        email: adminUser.email,
        role: 'owner',
        display_name: 'Platform Admin',
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    if (!testDb) return;
    for (const bizId of createdBusinessIds) {
      await testDb.delete(schema.subscriptionRequests).where(eq(schema.subscriptionRequests.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.auditLog).where(eq(schema.auditLog.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.users).where(eq(schema.users.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.businesses).where(eq(schema.businesses.id, bizId)).catch(() => undefined);
    }
    await closeTestDb(testDb);
  });

  beforeEach(() => {
    resetLoggedErrors();
  });

  it('1. 8 concurrent processSubscriptionClaim APPROVE calls on the SAME claim: exactly 1 winner, 7 ALREADY_PROCESSED', async () => {
    const biz = await createFreePlanBusiness(testDb);
    createdBusinessIds.push(biz.id);
    const owner = await createTestUser(testDb, { email: `owner-${randomUUID()}@example.com`, businessId: biz.id });
    const claim = await createPendingClaim(testDb, {
      businessId: biz.id,
      userId: owner.id,
      plan: 'professional',
      cycle: 'monthly',
      amountPaise: 99900,
    });

    const nowBefore = new Date();

    const results = await runConcurrently(8, () =>
      runAs(adminUser, () =>
        processSubscriptionClaim({
          request_id: claim.id,
          action: 'approve',
        }),
      ),
    );

    expect(results).toHaveLength(8);
    expect(countFulfilled(results)).toBe(8);

    const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    const successes = outcomes.filter((o) => o?.success === true);
    const failures = outcomes.filter((o) => o?.success === false);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(7);

    for (const fail of failures) {
      if (fail && !fail.success) {
        expect(fail.error.code).toBe('ALREADY_PROCESSED');
        expect(fail.error.message).toBe('This request has already been approved.');
      }
    }

    // Verify database state: request is approved
    const [requestRow] = await testDb
      .select()
      .from(schema.subscriptionRequests)
      .where(eq(schema.subscriptionRequests.id, claim.id));

    expect(requestRow).toBeDefined();
    expect(requestRow?.status).toBe('approved');
    expect(requestRow?.approved_at).toBeDefined();

    // Verify business subscription was advanced by exactly 1 cycle
    const [bizRow] = await testDb
      .select()
      .from(schema.businesses)
      .where(eq(schema.businesses.id, biz.id));

    expect(bizRow).toBeDefined();
    expect(bizRow?.subscription_plan).toBe('professional');
    expect(bizRow?.subscription_status).toBe('active');
    expect(bizRow?.subscription_ends_at).toBeDefined();

    const expectedExpiry = addBillingCycleUtc(nowBefore, 'monthly');
    const actualExpiry = new Date(bizRow!.subscription_ends_at!);
    // Difference should be within 10 seconds of expectedExpiry
    expect(Math.abs(actualExpiry.getTime() - expectedExpiry.getTime())).toBeLessThanOrEqual(10_000);

    // If DB-007 audit log present: exactly one approve audit row
    const auditRows = await testDb
      .select()
      .from(schema.auditLog)
      .where(
        eq(schema.auditLog.business_id, biz.id),
      );
    // writeAudit stores entity_type and action as separate columns ('subscription_request' + 'approve').
    const approveAudits = auditRows.filter(
      (a) => a.entity_type === 'subscription_request' && a.action === 'approve' && a.entity_id === claim.id,
    );
    expect(approveAudits).toHaveLength(1);

    // The 7 losers are logged as expected ActionErrors (ALREADY_PROCESSED); nothing unexpected may be logged.
    expect(unexpectedLoggedErrors()).toEqual([]);
  });

  it('1b. Feature G: 8 concurrent APPROVE calls on an Essentials -> Professional UPGRADE convert the unused time exactly once', async () => {
    const DAY = 86_400_000;
    const biz = await createFreePlanBusiness(testDb);
    createdBusinessIds.push(biz.id);
    const start = Date.now();
    await testDb
      .update(schema.businesses)
      .set({ subscription_plan: 'essentials', subscription_status: 'active', subscription_ends_at: new Date(start + 300 * DAY) })
      .where(eq(schema.businesses.id, biz.id));
    const owner = await createTestUser(testDb, { email: `owner-${randomUUID()}@example.com`, businessId: biz.id });
    const claim = await createPendingClaim(testDb, {
      businessId: biz.id,
      userId: owner.id,
      plan: 'professional',
      cycle: 'monthly',
      amountPaise: 59900,
    });

    const results = await runConcurrently(8, () =>
      runAs(adminUser, () => processSubscriptionClaim({ request_id: claim.id, action: 'approve' })),
    );
    const done = Date.now();
    const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    expect(outcomes.filter((o) => o?.success === true)).toHaveLength(1);
    expect(outcomes.filter((o) => o?.success === false)).toHaveLength(7);

    const [bizRow] = await testDb.select().from(schema.businesses).where(eq(schema.businesses.id, biz.id));
    expect(bizRow?.subscription_plan).toBe('professional');
    const ends = new Date(bizRow!.subscription_ends_at!).getTime();
    // Converted once: 300 days x 399/599 (= 199.83 days) of Professional, then one paid month. Never 300 days + a month.
    const credit = Math.floor((300 * DAY * 399) / 599);
    expect(ends).toBeGreaterThan(addBillingCycleUtc(new Date(start + credit - 60_000), 'monthly').getTime());
    expect(ends).toBeLessThan(addBillingCycleUtc(new Date(done + credit + 60_000), 'monthly').getTime());
    expect(unexpectedLoggedErrors()).toEqual([]);
  });

  it('2. Approve vs reject race (4 approve + 4 reject concurrent): exactly one terminal outcome', async () => {
    const biz = await createFreePlanBusiness(testDb);
    createdBusinessIds.push(biz.id);
    const owner = await createTestUser(testDb, { email: `owner-${randomUUID()}@example.com`, businessId: biz.id });
    const claim = await createPendingClaim(testDb, {
      businessId: biz.id,
      userId: owner.id,
      plan: 'essentials',
      cycle: 'yearly',
    });

    const results = await runConcurrently(8, (index) => {
      const action = index < 4 ? 'approve' : 'reject';
      return runAs(adminUser, () =>
        processSubscriptionClaim({
          request_id: claim.id,
          action,
          reject_reason: action === 'reject' ? 'Invalid UTR reference' : undefined,
        }),
      );
    });

    expect(results).toHaveLength(8);
    expect(countFulfilled(results)).toBe(8);

    const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    const successes = outcomes.filter((o) => o?.success === true);
    const failures = outcomes.filter((o) => o?.success === false);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(7);

    for (const fail of failures) {
      if (fail && !fail.success) {
        expect(fail.error.code).toBe('ALREADY_PROCESSED');
      }
    }

    const [requestRow] = await testDb
      .select()
      .from(schema.subscriptionRequests)
      .where(eq(schema.subscriptionRequests.id, claim.id));

    expect(requestRow).toBeDefined();
    expect(['approved', 'rejected']).toContain(requestRow?.status);

    const [bizRow] = await testDb
      .select()
      .from(schema.businesses)
      .where(eq(schema.businesses.id, biz.id));

    if (requestRow?.status === 'approved') {
      expect(bizRow?.subscription_plan).toBe('essentials');
      expect(bizRow?.subscription_status).toBe('active');
    } else {
      expect(bizRow?.subscription_plan).toBe('free');
    }
  });

  it('3. 6 concurrent submitPaymentClaim for same business: exactly 1 success, 5 friendly PENDING_CLAIM_EXISTS', async () => {
    const biz = await createFreePlanBusiness(testDb);
    createdBusinessIds.push(biz.id);
    const owner = await createTestUser(testDb, { email: `owner-${randomUUID()}@example.com`, businessId: biz.id });

    const tenantUser: HarnessUser = {
      id: owner.id,
      email: owner.email,
      businessId: biz.id,
      role: 'owner',
    };

    const results = await runConcurrently(6, (index) =>
      runAs(tenantUser, () =>
        submitPaymentClaim({
          plan_name: 'essentials',
          billing_cycle: 'monthly',
          payment_method: 'upi_qr',
          payment_reference: `UTR-RACE-${index}-${randomUUID()}`,
        }),
      ),
    );

    expect(results).toHaveLength(6);
    expect(countFulfilled(results)).toBe(6);

    const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    const successes = outcomes.filter((o) => o?.success === true);
    const failures = outcomes.filter((o) => o?.success === false);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(5);

    for (const fail of failures) {
      if (fail && !fail.success) {
        expect(fail.error.code).toBe('PENDING_CLAIM_EXISTS');
        expect(fail.error.message).toBe(
          'You already have a payment verification request pending. Please wait for our team to review it.',
        );
      }
    }

    // Database must contain exactly 1 pending row
    const pendingRows = await testDb
      .select()
      .from(schema.subscriptionRequests)
      .where(
        eq(schema.subscriptionRequests.business_id, biz.id),
      );

    expect(pendingRows).toHaveLength(1);
    expect(pendingRows[0].status).toBe('pending');
  });
});
