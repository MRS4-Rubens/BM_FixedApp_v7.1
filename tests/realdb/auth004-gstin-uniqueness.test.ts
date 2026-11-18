import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { NO_AUDIT_REQUEST_CONTEXT } from '@/lib/audit/log';
import { finalizeDraftInvoiceInTransaction } from '@/lib/invoices/finalize-invoice-tx';
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
  createTestUser,
  makeValidGstin,
  randomPan,
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

import { saveBusinessProfile } from '@/lib/actions/business/save-business-profile';
import type { BusinessProfileInput } from '@/lib/validations/business';

describe('AUTH-004: GSTIN Uniqueness & Identity Concurrency (REAL Postgres)', () => {
  let testDb: TestDb;
  const createdBusinessIds: string[] = [];
  const createdUserIds: string[] = [];

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
      await testDb.delete(schema.auditLog).where(eq(schema.auditLog.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.users).where(eq(schema.users.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.businesses).where(eq(schema.businesses.id, bizId)).catch(() => undefined);
    }
    for (const userId of createdUserIds) {
      await testDb.delete(schema.users).where(eq(schema.users.id, userId)).catch(() => undefined);
    }
    await closeTestDb(testDb);
  });

  beforeEach(() => {
    resetLoggedErrors();
  });

  function buildProfileInput(gstin: string, legalName = 'Acme Corp'): BusinessProfileInput {
    const stateCode = gstin.slice(0, 2);
    return {
      legal_name: legalName,
      trade_name: 'Acme Trade',
      gstin,
      pan: gstin.slice(2, 12),
      registration_type: 'regular',
      address_line1: '123 Market Road',
      city: 'Mumbai',
      state_code: stateCode,
      pincode: '400001',
      phone: '9876543210',
      email: 'acme@example.com',
      invoice_number_format: 'BMA/{FY}/{SEQ:4}',
      credit_note_number_prefix: 'CN',
    };
  }

  it('1. Concurrent first-time saveBusinessProfile with SAME GSTIN as 2 different users: exactly 1 winner, 1 friendly field error', async () => {
    const pan = randomPan();
    const targetGstin = makeValidGstin('27', pan);

    const user1 = await createTestUser(testDb, {
      email: `u1-${randomUUID()}@example.com`,
      businessId: null,
    });
    const user2 = await createTestUser(testDb, {
      email: `u2-${randomUUID()}@example.com`,
      businessId: null,
    });
    createdUserIds.push(user1.id, user2.id);

    const harnessUser1: HarnessUser = {
      id: user1.id,
      email: user1.email,
      businessId: null,
      role: 'owner',
    };
    const harnessUser2: HarnessUser = {
      id: user2.id,
      email: user2.email,
      businessId: null,
      role: 'owner',
    };

    const input1 = buildProfileInput(targetGstin, 'User 1 Corp');
    const input2 = buildProfileInput(targetGstin, 'User 2 Corp');

    const results = await runConcurrently(2, (index) => {
      const u = index === 0 ? harnessUser1 : harnessUser2;
      const inp = index === 0 ? input1 : input2;
      return runAs(u, () => saveBusinessProfile(inp));
    });

    expect(results).toHaveLength(2);
    expect(countFulfilled(results)).toBe(2);

    const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    const successes = outcomes.filter((o) => o?.success === true);
    const failures = outcomes.filter((o) => o?.success === false);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const winningData = successes[0];
    if (winningData?.success) {
      createdBusinessIds.push(winningData.data.businessId);
    }

    const failed = failures[0];
    if (failed && !failed.success) {
      expect(failed.error.code).toBe('GSTIN_ALREADY_REGISTERED');
      expect(failed.error.fieldErrors).toBeDefined();
      expect(failed.error.fieldErrors?.gstin).toBeDefined();
      expect(failed.error.fieldErrors?.gstin?.length).toBeGreaterThan(0);
    }

    // Verify DB: exactly 1 business row with that GSTIN
    const matchedBusinesses = await testDb
      .select()
      .from(schema.businesses)
      .where(eq(schema.businesses.gstin, targetGstin));
    expect(matchedBusinesses).toHaveLength(1);

    // Verify DB: loser's user row still has business_id = null
    const [refreshedUser1] = await testDb.select().from(schema.users).where(eq(schema.users.id, user1.id));
    const [refreshedUser2] = await testDb.select().from(schema.users).where(eq(schema.users.id, user2.id));

    const winnerUser = matchedBusinesses[0].id === refreshedUser1.business_id ? refreshedUser1 : refreshedUser2;
    const loserUser = winnerUser.id === refreshedUser1.id ? refreshedUser2 : refreshedUser1;

    expect(winnerUser.business_id).toBe(matchedBusinesses[0].id);
    expect(loserUser.business_id).toBeNull();
  });

  it('2. Same user double-submits 5x concurrently: exactly 1 business created, user linked once', async () => {
    const pan = randomPan();
    const targetGstin = makeValidGstin('27', pan);

    const user = await createTestUser(testDb, {
      email: `multi-submit-${randomUUID()}@example.com`,
      businessId: null,
    });
    createdUserIds.push(user.id);

    const harnessUser: HarnessUser = {
      id: user.id,
      email: user.email,
      businessId: null,
      role: 'owner',
    };

    const input = buildProfileInput(targetGstin, 'Concurrent Multi-Submit Corp');

    const results = await runConcurrently(5, () =>
      runAs(harnessUser, () => saveBusinessProfile(input)),
    );

    expect(results).toHaveLength(5);
    const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value : null));

    // At least one must succeed; any duplicate races handle gracefully (either succeeding with same business or catching duplicate)
    const successes = outcomes.filter((o) => o?.success === true);
    expect(successes.length).toBeGreaterThanOrEqual(1);

    const businessId = successes[0]?.success ? successes[0].data.businessId : '';
    expect(businessId).toBeTruthy();
    createdBusinessIds.push(businessId);

    // In the DB, exactly one business exists for this GSTIN
    const bizRows = await testDb
      .select()
      .from(schema.businesses)
      .where(eq(schema.businesses.gstin, targetGstin));
    expect(bizRows).toHaveLength(1);

    // The user's business_id is linked to that single business
    const [dbUser] = await testDb.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(dbUser.business_id).toBe(bizRows[0].id);
  });

  it('3. Case variants of the same GSTIN collide per AUTH-004 normalisation', async () => {
    const pan = randomPan();
    const canonicalGstin = makeValidGstin('27', pan);
    const lowerVariantGstin = canonicalGstin.toLowerCase();

    // User A registers with canonical GSTIN
    const userA = await createTestUser(testDb, {
      email: `usera-${randomUUID()}@example.com`,
      businessId: null,
    });
    createdUserIds.push(userA.id);

    const harnessUserA: HarnessUser = {
      id: userA.id,
      email: userA.email,
      businessId: null,
      role: 'owner',
    };

    const resA = await runAs(harnessUserA, () =>
      saveBusinessProfile(buildProfileInput(canonicalGstin, 'User A Corp')),
    );
    expect(resA.success).toBe(true);
    if (resA.success) {
      createdBusinessIds.push(resA.data.businessId);
    }

    // User B attempts to register with lower-case variant
    const userB = await createTestUser(testDb, {
      email: `userb-${randomUUID()}@example.com`,
      businessId: null,
    });
    createdUserIds.push(userB.id);

    const harnessUserB: HarnessUser = {
      id: userB.id,
      email: userB.email,
      businessId: null,
      role: 'owner',
    };

    const resB = await runAs(harnessUserB, () =>
      saveBusinessProfile(buildProfileInput(lowerVariantGstin, 'User B Corp')),
    );
    expect(resB.success).toBe(false);
    if (!resB.success) {
      expect(resB.error.code).toBe('GSTIN_ALREADY_REGISTERED');
    }
  });

  it('4. Editing existing business to a GSTIN owned by another business returns friendly field error', async () => {
    const pan1 = randomPan();
    const gstin1 = makeValidGstin('27', pan1);
    const pan2 = randomPan();
    const gstin2 = makeValidGstin('27', pan2);

    const user1 = await createTestUser(testDb, {
      email: `owner1-${randomUUID()}@example.com`,
      businessId: null,
    });
    const user2 = await createTestUser(testDb, {
      email: `owner2-${randomUUID()}@example.com`,
      businessId: null,
    });
    createdUserIds.push(user1.id, user2.id);

    const hUser1: HarnessUser = { id: user1.id, email: user1.email, businessId: null, role: 'owner' };
    const hUser2: HarnessUser = { id: user2.id, email: user2.email, businessId: null, role: 'owner' };

    const r1 = await runAs(hUser1, () => saveBusinessProfile(buildProfileInput(gstin1, 'Owner 1 Corp')));
    const r2 = await runAs(hUser2, () => saveBusinessProfile(buildProfileInput(gstin2, 'Owner 2 Corp')));
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    if (r1.success) createdBusinessIds.push(r1.data.businessId);
    if (r2.success) createdBusinessIds.push(r2.data.businessId);

    // Update user2 harness with their businessId
    const hUser2WithBiz: HarnessUser = {
      id: user2.id,
      email: user2.email,
      businessId: r2.success ? r2.data.businessId : null,
      role: 'owner',
    };

    // User 2 tries to change their GSTIN to gstin1 (owned by user 1)
    const editRes = await runAs(hUser2WithBiz, () =>
      saveBusinessProfile(buildProfileInput(gstin1, 'Owner 2 Renamed')),
    );

    expect(editRes.success).toBe(false);
    if (!editRes.success) {
      expect(editRes.error.code).toBe('GSTIN_ALREADY_REGISTERED');
      expect(editRes.error.fieldErrors?.gstin).toBeDefined();
    }

    // Verify User 2's business row retained gstin2
    const [biz2] = await testDb
      .select()
      .from(schema.businesses)
      .where(eq(schema.businesses.id, r2.success ? r2.data.businessId : ''));
    expect(biz2.gstin).toBe(gstin2);
  });

  it('5. After a FINALIZED invoice exists, changing GSTIN/state is rejected with IDENTITY_LOCKED; before it, allowed', async () => {
    const panA = randomPan();
    const gstinA = makeValidGstin('27', panA);
    const panB = randomPan();
    const gstinB = makeValidGstin('27', panB);

    const user = await createTestUser(testDb, {
      email: `lock-test-${randomUUID()}@example.com`,
      businessId: null,
    });
    createdUserIds.push(user.id);

    const hUserInitial: HarnessUser = {
      id: user.id,
      email: user.email,
      businessId: null,
      role: 'owner',
    };

    const initialSave = await runAs(hUserInitial, () =>
      saveBusinessProfile(buildProfileInput(gstinA, 'Pre-lock Corp')),
    );
    expect(initialSave.success).toBe(true);
    const bizId = initialSave.success ? initialSave.data.businessId : '';
    createdBusinessIds.push(bizId);

    const hUserWithBiz: HarnessUser = {
      id: user.id,
      email: user.email,
      businessId: bizId,
      role: 'owner',
    };

    // 5a. Before any finalized invoice exists: changing GSTIN is ALLOWED
    const editBeforeFinalize = await runAs(hUserWithBiz, () =>
      saveBusinessProfile(buildProfileInput(gstinB, 'Edited Pre-lock Corp')),
    );
    expect(editBeforeFinalize.success).toBe(true);

    const [bizAfterEdit] = await testDb
      .select()
      .from(schema.businesses)
      .where(eq(schema.businesses.id, bizId));
    expect(bizAfterEdit.gstin).toBe(gstinB);

    // 5b. Finalize an invoice for this business
    const draft = await createTestDraftInvoice(testDb, bizId);
    await testDb.transaction((tx) =>
      finalizeDraftInvoiceInTransaction(tx, {
        invoiceId: draft.invoiceId,
        businessId: bizId,
        actorUserId: user.id,
        requestContext: NO_AUDIT_REQUEST_CONTEXT,
      }),
    );

    // 5c. After finalized invoice exists: attempting to change GSTIN must fail with IDENTITY_LOCKED
    const panC = randomPan();
    const gstinC = makeValidGstin('27', panC);

    const editAfterFinalize = await runAs(hUserWithBiz, () =>
      saveBusinessProfile(buildProfileInput(gstinC, 'Post-lock Corp')),
    );

    expect(editAfterFinalize.success).toBe(false);
    if (!editAfterFinalize.success) {
      expect(editAfterFinalize.error.code).toBe('IDENTITY_LOCKED');
      expect(editAfterFinalize.error.fieldErrors?.gstin).toBeDefined();
    }

    // Confirm DB row was NOT changed
    const [bizPostCheck] = await testDb
      .select()
      .from(schema.businesses)
      .where(eq(schema.businesses.id, bizId));
    expect(bizPostCheck.gstin).toBe(gstinB);
  });
});
