import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { saveBusinessProfileInTransaction } from '@/lib/business/save-profile-tx';
import { businessProfileSchema } from '@/lib/validations/business';
import { type TestDb, getTestDatabaseUrl, validateTestDatabaseUrl, createTestDbClient, cleanupTestBusiness } from './helpers/db';
import { makeValidGstin } from './helpers/fixtures';

/**
 * AUTH-004 / COMP-001 (moved by TEST-02 from tests/integration, where a "skip when no test database" guard silently skipped it):
 * a GSTIN change must wait for a transaction that holds a lock on the business row while it finalizes, and once that
 * finalized invoice is committed, the change must be refused with IDENTITY_LOCKED. Waiting is observed in Postgres
 * itself (pg_stat_activity), not guessed with fixed sleeps.
 */
describe('AUTH-004: identity change waits for an in-flight finalize, then is refused (REAL Postgres)', () => {
  let testDb: TestDb;
  const createdUserIds: string[] = [];
  const createdBusinessIds: string[] = [];

  beforeAll(async () => {
    testDb = createTestDbClient(validateTestDatabaseUrl(getTestDatabaseUrl()));
  }, 60_000);

  afterAll(async () => {
    if (!testDb) return;
    for (const businessId of createdBusinessIds) await cleanupTestBusiness(testDb, businessId);
    for (const userId of createdUserIds) {
      await testDb.delete(schema.users).where(eq(schema.users.id, userId)).catch(() => undefined);
    }
  }, 60_000);

  async function createStandaloneUser(): Promise<string> {
    const userId = randomUUID();
    const hex = randomBytes(4).toString('hex');
    await testDb.insert(schema.users).values({
      id: userId,
      auth_user_id: `auth_${hex}`,
      email: `lock_${hex}@test.dev`,
      role: 'owner',
      display_name: `Lock User ${hex}`,
      business_id: null,
    });
    createdUserIds.push(userId);
    return userId;
  }

  /** Polls Postgres until another session is waiting on a row lock (or the deadline passes). */
  async function waitForBlockedSession(deadlineMs: number): Promise<boolean> {
    const until = Date.now() + deadlineMs;
    while (Date.now() < until) {
      const result = await testDb.execute(
        sql`SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
      );
      const waiting = Number((result.rows[0] as { waiting?: number } | undefined)?.waiting ?? 0);
      if (waiting > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }

  const profile = (legalName: string, gstin: string) =>
    businessProfileSchema.parse({
      legal_name: legalName,
      gstin,
      state_code: '29',
      registration_type: 'regular' as const,
      address_line1: '200 Lock Ave',
      city: 'Bengaluru',
      pincode: '560001',
    });

  it('a lock held on the business blocks the GSTIN change until commit, then the change throws IDENTITY_LOCKED', async () => {
    const userId = await createStandaloneUser();
    const gstin = makeValidGstin('29');
    const { businessId } = await testDb.transaction((tx) =>
      saveBusinessProfileInTransaction(tx, { userId, profile: profile('Lock Test Biz', gstin) }),
    );
    createdBusinessIds.push(businessId);

    const [fy] = await testDb
      .select({ id: schema.financialYears.id })
      .from(schema.financialYears)
      .where(eq(schema.financialYears.business_id, businessId));
    if (!fy) throw new Error('financial year missing');

    let releaseFinalize!: () => void;
    const finalizeMayCommit = new Promise<void>((resolve) => {
      releaseFinalize = resolve;
    });
    let lockHeld!: () => void;
    const lockIsHeld = new Promise<void>((resolve) => {
      lockHeld = resolve;
    });

    // Session 1: like finalize, holds a lock on the business row and inserts a finalized invoice before committing.
    const finalizeSession = testDb.transaction(async (tx) => {
      await tx.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).for('share');
      lockHeld();
      await finalizeMayCommit;
      await tx.insert(schema.invoices).values({
        business_id: businessId,
        financial_year_id: fy.id,
        invoice_number: 'INV/26-27/0099',
        invoice_sequence: 99,
        lifecycle_status: 'finalized',
        invoice_date: '2026-10-25',
        due_date: '2026-11-24',
        finalized_at: new Date(),
        place_of_supply_state_code: '29',
        seller_name_snapshot: 'Lock Test Biz',
        seller_gstin_snapshot: gstin,
        seller_state_code_snapshot: '29',
        seller_address_snapshot: { line1: '200 Lock Ave', line2: null, city: 'Bengaluru', pincode: '560001' },
        seller_snapshot_source: 'captured_at_finalization',
      });
    });
    await lockIsHeld;

    // Session 2: the owner changes the GSTIN (takes FOR UPDATE on the business row).
    let changeFinished = false;
    const changeSession = testDb
      .transaction((tx) =>
        saveBusinessProfileInTransaction(tx, { userId, profile: profile('Lock Test Biz (Renamed)', makeValidGstin('29')) }),
      )
      .then(
        () => null,
        (error: unknown) => error,
      )
      .finally(() => {
        changeFinished = true;
      });

    // Postgres itself reports session 2 waiting on the lock, and it has not finished.
    expect(await waitForBlockedSession(10_000)).toBe(true);
    expect(changeFinished).toBe(false);

    releaseFinalize();
    await finalizeSession;
    const changeError = await changeSession;

    expect(changeError).not.toBeNull();
    expect((changeError as { code?: string }).code).toBe('IDENTITY_LOCKED');
    const [business] = await testDb
      .select({ gstin: schema.businesses.gstin })
      .from(schema.businesses)
      .where(eq(schema.businesses.id, businessId));
    expect(business?.gstin).toBe(gstin); // unchanged
  }, 60_000);
});
