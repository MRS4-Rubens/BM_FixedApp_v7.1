import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyClaimInsertError, PENDING_CLAIM_INDEX_NAME } from '@/lib/subscriptions/claim-errors';
import { getPgError } from '@/lib/db/pg-error';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');
const DB005_SUFFIX = 'db005_index_hardening';

const CREATED_INDEXES = [
  'subscription_requests_one_pending_per_biz',
  'invoices_archival_retry_idx',
  'customers_biz_name_idx',
  'products_biz_active_idx',
  'invoice_line_items_product_idx',
  'audit_log_biz_created_idx',
  'subscription_requests_user_id_idx',
  'invoices_biz_customer_idx',
] as const;

const DROPPED_INDEXES = [
  'invoices_lifecycle_status_idx',
  'invoices_payment_status_idx',
  'invoices_business_id_idx',
  'credit_notes_lifecycle_status_idx',
  'credit_notes_status_idx',
  'payments_status_idx',
] as const;

const KEEP_INDEXES = [
  'invoices_customer_id_idx',
  'invoices_invoice_date_idx',
  'invoices_archival_status_idx',
  'invoices_biz_lifecycle_date_idx',
  'invoices_biz_created_at_idx',
  'payments_invoice_status_idx',
  'payments_business_id_idx',
  'credit_notes_biz_lifecycle_status_date_idx',
  'subscription_requests_business_id_idx',
  'subscription_requests_status_idx',
] as const;

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJournal(): readonly JournalEntry[] {
  const raw: unknown = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'));
  if (!isRecord(raw) || !Array.isArray(raw.entries)) {
    throw new Error('journal has no entries array');
  }
  return raw.entries.map((entry: unknown): JournalEntry => {
    if (!isRecord(entry) || typeof entry.idx !== 'number' || typeof entry.tag !== 'string') {
      throw new Error('malformed journal entry');
    }
    return { idx: entry.idx, tag: entry.tag };
  });
}

function statementsOf(tag: string): readonly string[] {
  return readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function resolveDb005(): { readonly tag: string; readonly previousTag: string } {
  const journal = readJournal();
  const position = journal.findIndex((entry) => entry.tag.includes(DB005_SUFFIX));
  const entry = journal[position];
  const previous = journal[position - 1];
  if (position < 1 || !entry || !previous) {
    throw new Error(`journal has no migration matching ${DB005_SUFFIX}`);
  }
  return { tag: entry.tag, previousTag: previous.tag };
}

const { tag: DB005_TAG, previousTag: PRE_DB005_TAG } = resolveDb005();

interface IdRow {
  readonly id: string;
}

async function insertOne(db: PGlite, sqlText: string, params: readonly unknown[] = []): Promise<string> {
  const result = await db.query<IdRow>(sqlText, params as unknown[]);
  const row = result.rows[0];
  if (!row) {
    throw new Error(`no row returned for: ${sqlText}`);
  }
  return row.id;
}

let counter = 0;
function nextNumber(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}-${Date.now()}`;
}

async function extractPlanText(db: PGlite, explainSql: string, params: readonly unknown[] = []): Promise<string> {
  const res = await db.query<Record<string, unknown>>(explainSql, params as unknown[]);
  return res.rows
    .map((row) => Object.values(row).map((val) => String(val)).join(' '))
    .join('\n');
}

describe('DB-005 index hardening and atomic one-pending-claim invariant', () => {
  let db: PGlite;
  let businessAId: string;
  let userAId: string;
  let businessBId: string;
  let userBId: string;

  beforeAll(async () => {
    db = new PGlite();

    // Apply all migrations up to and including DB-005
    for (const entry of readJournal()) {
      for (const statement of statementsOf(entry.tag)) {
        await db.exec(statement);
      }
      if (entry.tag === DB005_TAG) break;
    }

    // Seed test businesses and users
    businessAId = await insertOne(
      db,
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Biz A', '27AABCA1234A1Z5', '10 Main St', 'Mumbai', '27', '400001') RETURNING id`
    );
    userAId = await insertOne(
      db,
      `INSERT INTO users (business_id, auth_user_id, email, display_name, role)
       VALUES ($1, $2, 'user-a@test.dev', 'User A', 'owner') RETURNING id`,
      [businessAId, nextNumber('AUTH-A')]
    );

    businessBId = await insertOne(
      db,
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Biz B', '29BBBBA1234B1Z5', '20 Sub St', 'Bengaluru', '29', '560001') RETURNING id`
    );
    userBId = await insertOne(
      db,
      `INSERT INTO users (business_id, auth_user_id, email, display_name, role)
       VALUES ($1, $2, 'user-b@test.dev', 'User B', 'owner') RETURNING id`,
      [businessBId, nextNumber('AUTH-B')]
    );
  }, 60_000);

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  it('1. catalogue: 8 created indexes exist, 6 dropped indexes do not, KEEP indexes exist', async () => {
    const res = await db.query<{ readonly indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
    );
    const existing = new Set(res.rows.map((r) => r.indexname));

    for (const name of CREATED_INDEXES) {
      expect(existing.has(name), `Expected created index ${name} to exist`).toBe(true);
    }

    for (const name of DROPPED_INDEXES) {
      expect(existing.has(name), `Expected dropped index ${name} NOT to exist`).toBe(false);
    }

    for (const name of KEEP_INDEXES) {
      expect(existing.has(name), `Expected keep index ${name} to exist`).toBe(true);
    }
  });

  it('2. uniqueness: at most one pending claim per business, approved/rejected rows and other businesses allowed', async () => {
    // 1. Insert first pending claim for Biz A -> succeeds
    const ref1 = nextNumber('UTR-A1');
    const req1 = await insertOne(
      db,
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status)
       VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', $3, 'pending') RETURNING id`,
      [businessAId, userAId, ref1]
    );
    expect(req1).toBeDefined();

    // 2. Second pending claim for same Biz A -> rejected with 23505 and constraint PENDING_CLAIM_INDEX_NAME
    const ref2 = nextNumber('UTR-A2');
    let rejectedError: unknown;
    try {
      await db.query(
        `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status)
         VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', $3, 'pending')`,
        [businessAId, userAId, ref2]
      );
    } catch (err: unknown) {
      rejectedError = err;
    }
    expect(rejectedError).toBeDefined();
    const pgErr = getPgError(rejectedError);
    expect(pgErr.code).toBe('23505');
    expect(pgErr.constraint).toBe(PENDING_CLAIM_INDEX_NAME);
    expect(classifyClaimInsertError(rejectedError)).toBe('PENDING_CLAIM_EXISTS');

    // 3. Pending claim for Biz B -> allowed (different business)
    const refB = nextNumber('UTR-B1');
    const reqB = await insertOne(
      db,
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status)
       VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', $3, 'pending') RETURNING id`,
      [businessBId, userBId, refB]
    );
    expect(reqB).toBeDefined();

    // 4. Flip first request to 'approved' -> new pending claim for Biz A now allowed
    await db.query(`UPDATE subscription_requests SET status = 'approved' WHERE id = $1`, [req1]);

    const ref3 = nextNumber('UTR-A3');
    const req3 = await insertOne(
      db,
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status)
       VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', $3, 'pending') RETURNING id`,
      [businessAId, userAId, ref3]
    );
    expect(req3).toBeDefined();

    // 5. Flip request 3 to 'rejected'
    await db.query(`UPDATE subscription_requests SET status = 'rejected' WHERE id = $1`, [req3]);

    // 6. Many non-pending (approved/rejected) rows for one business are allowed
    const ref4 = nextNumber('UTR-A4');
    const req4 = await insertOne(
      db,
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status)
       VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', $3, 'approved') RETURNING id`,
      [businessAId, userAId, ref4]
    );
    expect(req4).toBeDefined();

    const ref5 = nextNumber('UTR-A5');
    const req5 = await insertOne(
      db,
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status)
       VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', $3, 'rejected') RETURNING id`,
      [businessAId, userAId, ref5]
    );
    expect(req5).toBeDefined();
  });

  it('3. race shape: Promise.allSettled of two concurrent inserts yields exactly one fulfilled, one rejected', async () => {
    // Note: PGlite runs in a single Node process and serialises queries, so this test proves
    // database invariant enforcement (partial unique constraint) under concurrent application invocations.
    const raceBizId = await insertOne(
      db,
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Race Biz', '27AACCR1234R1Z5', '30 Race St', 'Pune', '27', '411001') RETURNING id`
    );
    const raceUserId = await insertOne(
      db,
      `INSERT INTO users (business_id, auth_user_id, email, display_name, role)
       VALUES ($1, $2, 'race@test.dev', 'Race User', 'owner') RETURNING id`,
      [raceBizId, nextNumber('AUTH-RACE')]
    );

    const refRace1 = nextNumber('UTR-RACE-1');
    const refRace2 = nextNumber('UTR-RACE-2');

    const results = await Promise.allSettled([
      insertOne(
        db,
        `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status)
         VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', $3, 'pending') RETURNING id`,
        [raceBizId, raceUserId, refRace1]
      ),
      insertOne(
        db,
        `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status)
         VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', $3, 'pending') RETURNING id`,
        [raceBizId, raceUserId, refRace2]
      ),
    ]);

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const pgErr = getPgError(rejected[0]?.reason);
    expect(pgErr.code).toBe('23505');
    expect(pgErr.constraint).toBe(PENDING_CLAIM_INDEX_NAME);
    expect(classifyClaimInsertError(rejected[0]?.reason)).toBe('PENDING_CLAIM_EXISTS');
  });

  it('4. duplicate UTR constraint remains classified as DUPLICATE_REFERENCE', async () => {
    const dupUtr = nextNumber('UTR-SHARED');
    // First insert succeeds
    await insertOne(
      db,
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status)
       VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', $3, 'approved') RETURNING id`,
      [businessAId, userAId, dupUtr]
    );

    // Second insert with same reference for a different business throws 23505 on payment_reference
    let dupErr: unknown;
    try {
      await db.query(
        `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status)
         VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', $3, 'approved')`,
        [businessBId, userBId, dupUtr]
      );
    } catch (err: unknown) {
      dupErr = err;
    }

    expect(dupErr).toBeDefined();
    const pgErr = getPgError(dupErr);
    expect(pgErr.code).toBe('23505');
    expect(pgErr.constraint).not.toBe(PENDING_CLAIM_INDEX_NAME);
    expect(classifyClaimInsertError(dupErr)).toBe('DUPLICATE_REFERENCE');
  });

  it('5. pre-flight guard: fails whole migration when duplicate pending claims exist and leaves catalogue unchanged', async () => {
    const guardDb = new PGlite();

    // 1. Apply up to the PREVIOUS migration
    for (const entry of readJournal()) {
      for (const statement of statementsOf(entry.tag)) {
        await guardDb.exec(statement);
      }
      if (entry.tag === PRE_DB005_TAG) break;
    }

    // Capture initial indexes before attempting DB-005
    const preRes = await guardDb.query<{ readonly indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
    );
    const preIndexes = new Set(preRes.rows.map((r) => r.indexname));

    // 2. Insert two pending requests for one business (valid before DB-005)
    const dirtyBizId = await insertOne(
      guardDb,
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Dirty Biz', '27AADCD1234D1Z5', '40 Dirty St', 'Nashik', '27', '422001') RETURNING id`
    );
    const dirtyUserId = await insertOne(
      guardDb,
      `INSERT INTO users (business_id, auth_user_id, email, display_name, role)
       VALUES ($1, $2, 'dirty@test.dev', 'Dirty User', 'owner') RETURNING id`,
      [dirtyBizId, nextNumber('AUTH-DIRTY')]
    );

    await insertOne(
      guardDb,
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status)
       VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', $3, 'pending') RETURNING id`,
      [dirtyBizId, dirtyUserId, nextNumber('UTR-DIRTY-1')]
    );
    await insertOne(
      guardDb,
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status)
       VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', $3, 'pending') RETURNING id`,
      [dirtyBizId, dirtyUserId, nextNumber('UTR-DIRTY-2')]
    );

    // 3. Attempt DB-005 inside a transaction
    let errorCaught: unknown;
    await guardDb.exec('BEGIN;');
    try {
      for (const statement of statementsOf(DB005_TAG)) {
        await guardDb.exec(statement);
      }
      await guardDb.exec('COMMIT;');
    } catch (err: unknown) {
      errorCaught = err;
      await guardDb.exec('ROLLBACK;');
    }

    expect(errorCaught).toBeDefined();
    const errMsg = String(errorCaught);
    expect(errMsg).toContain('DB-005 pre-flight failed');

    // 4. Assert pg_indexes catalogue is completely unchanged
    const postRes = await guardDb.query<{ readonly indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
    );
    const postIndexes = new Set(postRes.rows.map((r) => r.indexname));

    expect(postIndexes).toEqual(preIndexes);
    expect(postIndexes.has('subscription_requests_one_pending_per_biz')).toBe(false);

    await guardDb.close();
  }, 60_000);

  it('6. idempotency: applying DB-005 statements a second time succeeds without error', async () => {
    for (const statement of statementsOf(DB005_TAG)) {
      await db.exec(statement);
    }

    const res = await db.query<{ readonly indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
    );
    const names = new Set(res.rows.map((r) => r.indexname));

    for (const idxName of CREATED_INDEXES) {
      expect(names.has(idxName)).toBe(true);
    }
  });

  it('7. planner eligibility: EXPLAIN uses created indexes when seqscan is off', async () => {
    await db.exec('SET enable_seqscan = off;');

    // 1. invoices_archival_retry_idx
    const archivalPlan = await extractPlanText(
      db,
      `EXPLAIN SELECT id FROM invoices
       WHERE archival_status IN ('pending', 'failed') AND archival_attempts < 5
       ORDER BY finalized_at ASC LIMIT 20`
    );
    expect(archivalPlan).toContain('invoices_archival_retry_idx');

    // 2. customers_biz_name_idx
    const customerPlan = await extractPlanText(
      db,
      `EXPLAIN SELECT * FROM customers
       WHERE business_id = '00000000-0000-0000-0000-000000000001'
       ORDER BY name`
    );
    expect(customerPlan).toContain('customers_biz_name_idx');

    // 3. invoices_biz_customer_idx
    const invoiceCustomerPlan = await extractPlanText(
      db,
      `EXPLAIN SELECT * FROM invoices
       WHERE business_id = '00000000-0000-0000-0000-000000000001'
         AND customer_id = '00000000-0000-0000-0000-000000000002'`
    );
    expect(invoiceCustomerPlan).toContain('invoices_biz_customer_idx');

    await db.exec('SET enable_seqscan = on;');
  });
});
