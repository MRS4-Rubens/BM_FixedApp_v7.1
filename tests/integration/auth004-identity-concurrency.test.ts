import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { saveBusinessProfileInTransaction } from '@/lib/business/save-profile-tx';
import { isGstinUniqueViolation } from '@/lib/business/identity-policy';
import { businessProfileSchema } from '@/lib/validations/business';
import {
  TestDb,
  getTestDatabaseUrl,
  validateTestDatabaseUrl,
  createTestDbClient,
} from './helpers/db';

const testDbUrl = getTestDatabaseUrl();

describe.skipIf(!testDbUrl)('AUTH-004 Identity Concurrency (REAL Postgres)', () => {
  let testDb: TestDb;
  const createdUserIds: string[] = [];
  const createdBusinessIds: string[] = [];

  beforeAll(async () => {
    const validUrl = validateTestDatabaseUrl(testDbUrl);
    testDb = createTestDbClient(validUrl);
  }, 60_000);

  afterAll(async () => {
    if (!testDb) return;
    for (const bizId of createdBusinessIds) {
      await testDb.delete(schema.invoices).where(eq(schema.invoices.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.financialYears).where(eq(schema.financialYears.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.auditLog).where(eq(schema.auditLog.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.users).where(eq(schema.users.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.businesses).where(eq(schema.businesses.id, bizId)).catch(() => undefined);
    }
    for (const uId of createdUserIds) {
      await testDb.delete(schema.users).where(eq(schema.users.id, uId)).catch(() => undefined);
    }
  }, 60_000);

  async function createStandaloneUser(): Promise<string> {
    const userId = randomUUID();
    const hex = randomBytes(4).toString('hex');
    await testDb.insert(schema.users).values({
      id: userId,
      auth_user_id: `auth_${hex}`,
      email: `conc_${hex}@test.dev`,
      role: 'owner',
      display_name: `Concurrent User ${hex}`,
      business_id: null,
    });
    createdUserIds.push(userId);
    return userId;
  }

  function generateValidGstin(): string {
    const hex = randomBytes(4).toString('hex').toUpperCase();
    return `29TESTB${hex}1Z5`;
  }

  it('5 parallel first-time saves for ONE user share one businessId (1 created, 4 updated)', async () => {
    const userId = await createStandaloneUser();
    const gstin = generateValidGstin();

    const payload = businessProfileSchema.parse({
      legal_name: 'Concurrent Single User Biz',
      gstin,
      state_code: '29',
      registration_type: 'regular' as const,
      address_line1: '100 Concurrency St',
      city: 'Bengaluru',
      pincode: '560001',
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        testDb.transaction((tx) =>
          saveBusinessProfileInTransaction(tx, {
            userId,
            profile: payload,
          }),
        ),
      ),
    );

    const businessId = results[0].businessId;
    createdBusinessIds.push(businessId);

    // All return the exact same businessId
    for (const res of results) {
      expect(res.businessId).toBe(businessId);
    }

    // Exactly 1 created, 4 updated
    const createdCount = results.filter((r) => r.mode === 'created').length;
    const updatedCount = results.filter((r) => r.mode === 'updated').length;
    expect(createdCount).toBe(1);
    expect(updatedCount).toBe(4);

    // Exactly 1 business row in DB
    const bizRows = await testDb
      .select({ id: schema.businesses.id })
      .from(schema.businesses)
      .where(eq(schema.businesses.gstin, gstin));
    expect(bizRows.length).toBe(1);

    // Exactly 1 FY row in DB
    const fyRows = await testDb
      .select({ id: schema.financialYears.id })
      .from(schema.financialYears)
      .where(eq(schema.financialYears.business_id, businessId));
    expect(fyRows.length).toBe(1);

    // User is linked to this business
    const [userRow] = await testDb
      .select({ business_id: schema.users.business_id })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    expect(userRow?.business_id).toBe(businessId);
  });

  it('2 parallel first-time saves by TWO users with the same GSTIN: exactly one fulfills, other gets unique violation', async () => {
    const user1Id = await createStandaloneUser();
    const user2Id = await createStandaloneUser();
    const gstin = generateValidGstin();

    const payload1 = businessProfileSchema.parse({
      legal_name: 'User 1 Race Biz',
      gstin,
      state_code: '29',
      registration_type: 'regular' as const,
      address_line1: '101 Race Way',
      city: 'Bengaluru',
      pincode: '560001',
    });

    const payload2 = businessProfileSchema.parse({
      legal_name: 'User 2 Race Biz',
      gstin,
      state_code: '29',
      registration_type: 'regular' as const,
      address_line1: '102 Race Way',
      city: 'Bengaluru',
      pincode: '560001',
    });

    const settled = await Promise.allSettled([
      testDb.transaction((tx) =>
        saveBusinessProfileInTransaction(tx, {
          userId: user1Id,
          profile: payload1,
        }),
      ),
      testDb.transaction((tx) =>
        saveBusinessProfileInTransaction(tx, {
          userId: user2Id,
          profile: payload2,
        }),
      ),
    ]);

    const fulfilled = settled.filter(
      (s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof saveBusinessProfileInTransaction>>> =>
        s.status === 'fulfilled',
    );
    const rejected = settled.filter(
      (s): s is PromiseRejectedResult => s.status === 'rejected',
    );

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    createdBusinessIds.push(fulfilled[0].value.businessId);

    // The rejected one failed with unique violation on businesses_gstin_unique
    expect(isGstinUniqueViolation(rejected[0].reason)).toBe(true);

    // DB has exactly 1 business row
    const bizRows = await testDb
      .select({ id: schema.businesses.id })
      .from(schema.businesses)
      .where(eq(schema.businesses.gstin, gstin));
    expect(bizRows.length).toBe(1);
  });

  it('Finalize/identity serialization: FOR SHARE lock on business blocks GSTIN change until commit, then throws IDENTITY_LOCKED', async () => {
    const userId = await createStandaloneUser();
    const gstin = generateValidGstin();

    // 1. Initial setup
    const initialRes = await testDb.transaction((tx) =>
      saveBusinessProfileInTransaction(tx, {
        userId,
        profile: businessProfileSchema.parse({
          legal_name: 'Serialization Test Biz',
          gstin,
          state_code: '29',
          registration_type: 'regular' as const,
          address_line1: '200 Lock Ave',
          city: 'Bengaluru',
          pincode: '560001',
        }),
      }),
    );
    const businessId = initialRes.businessId;
    createdBusinessIds.push(businessId);

    const [fy] = await testDb
      .select({ id: schema.financialYears.id })
      .from(schema.financialYears)
      .where(eq(schema.financialYears.business_id, businessId));
    if (!fy) throw new Error('FY missing');

    const nextGstin = generateValidGstin();
    let tx1Ready = false;
    let tx1CanCommit = false;
    let tx2Started = false;
    let tx2Finished = false;
    let tx2Error: unknown = null;

    // Connection 1: opens transaction, takes FOR SHARE on business, waits, inserts finalized invoice, commits
    const conn1Promise = testDb.transaction(async (tx1) => {
      // FOR SHARE lock (what finalize now does)
      await tx1
        .select({ id: schema.businesses.id })
        .from(schema.businesses)
        .where(eq(schema.businesses.id, businessId))
        .for('share');

      tx1Ready = true;

      // Poll until tx2 has attempted to start and is blocked waiting on the row lock
      const start = Date.now();
      while (!tx1CanCommit && Date.now() - start < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Insert finalized invoice while holding the FOR SHARE lock
      await tx1.insert(schema.invoices).values({
        business_id: businessId,
        financial_year_id: fy.id,
        invoice_number: 'INV/2026-27/0099',
        invoice_sequence: 99,
        lifecycle_status: 'finalized',
        invoice_date: '2026-10-25',
        due_date: '2026-11-24',
        finalized_at: new Date(),
        place_of_supply_state_code: '29',
        seller_name_snapshot: 'Serialization Test Biz',
        seller_gstin_snapshot: gstin,
        seller_state_code_snapshot: '29',
        seller_address_snapshot: { line1: '200 Lock Ave', line2: null, city: 'Bengaluru', pincode: '560001' },
        seller_snapshot_source: 'captured_at_finalization',
      });
    });

    // Wait until tx1 holds FOR SHARE lock
    while (!tx1Ready) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Connection 2: attempts GSTIN change (which takes FOR UPDATE on business)
    const conn2Promise = (async () => {
      tx2Started = true;
      try {
        await testDb.transaction((tx2) =>
          saveBusinessProfileInTransaction(tx2, {
            userId,
            profile: businessProfileSchema.parse({
              legal_name: 'Serialization Test Biz (Renamed)',
              gstin: nextGstin,
              state_code: '29',
              registration_type: 'regular' as const,
              address_line1: '200 Lock Ave',
              city: 'Bengaluru',
              pincode: '560001',
            }),
          }),
        );
      } catch (err: unknown) {
        tx2Error = err;
      } finally {
        tx2Finished = true;
      }
    })();

    // Verify tx2 is blocked while tx1 is open
    expect(tx2Started).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    // tx2 must NOT have finished yet because it is blocked by tx1's FOR SHARE lock!
    expect(tx2Finished).toBe(false);

    // Now release tx1 to commit
    tx1CanCommit = true;

    await Promise.all([conn1Promise, conn2Promise]);

    // After tx1 commits, tx2 resumes and must fail with IDENTITY_LOCKED
    expect(tx2Finished).toBe(true);
    expect(tx2Error).not.toBeNull();
    const errorObj = tx2Error as { code?: string };
    expect(errorObj?.code).toBe('IDENTITY_LOCKED');
  });
});
