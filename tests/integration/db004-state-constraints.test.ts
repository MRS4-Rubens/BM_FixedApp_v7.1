import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  INVOICE_TEMPLATE_IDS,
  RECORD_STATUSES,
  REQUEST_BILLING_CYCLES,
  REQUEST_PAYMENT_METHODS,
  REQUEST_STATUSES,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_STATUSES,
} from '@/lib/db/domain-values';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');
const DB004_SUFFIX = 'db004_state_check_constraints';

interface JournalEntry {
  idx: number;
  tag: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJournal(): JournalEntry[] {
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

function statementsOf(tag: string): string[] {
  return readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function resolveDb004(): { tag: string; previousTag: string } {
  const journal = readJournal();
  const position = journal.findIndex((entry) => entry.tag.includes(DB004_SUFFIX));
  const entry = journal[position];
  const previous = journal[position - 1];
  if (position < 1 || !entry || !previous) {
    throw new Error(`journal has no migration matching ${DB004_SUFFIX}`);
  }
  return { tag: entry.tag, previousTag: previous.tag };
}

const { tag: DB004_TAG, previousTag: PRE_DB004_TAG } = resolveDb004();

interface IdRow {
  id: string;
}

async function insertOne(db: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const result = await db.query<IdRow>(sqlText, params);
  const row = result.rows[0];
  if (!row) {
    throw new Error(`no row returned for: ${sqlText}`);
  }
  return row.id;
}

interface Fixture {
  businessId: string;
  userId: string;
  financialYearId: string;
  invoiceId: string;
  creditNoteId: string;
}

let counter = 0;
function nextNumber(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

describe('DB-004 state check constraints integration (PGlite)', () => {
  let db: PGlite;
  let fx: Fixture;

  beforeAll(async () => {
    db = new PGlite();

    // Apply all migrations up to and including DB-004
    for (const entry of readJournal()) {
      for (const statement of statementsOf(entry.tag)) {
        await db.exec(statement);
      }
      if (entry.tag === DB004_TAG) break;
    }

    // Seed baseline fixture data
    const businessId = await insertOne(
      db,
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Acme Corp', '27AABCA1234A1Z5', '10 Main St', 'Mumbai', '27', '400001') RETURNING id`
    );

    const userId = await insertOne(
      db,
      `INSERT INTO users (business_id, auth_user_id, email, display_name, role)
       VALUES ($1, 'auth-user-004', 'owner@acme.com', 'Owner', 'owner') RETURNING id`,
      [businessId]
    );

    const financialYearId = await insertOne(
      db,
      `INSERT INTO financial_years (business_id, label, start_date, end_date)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31') RETURNING id`,
      [businessId]
    );

    const invoiceId = await insertOne(
      db,
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, subtotal_paise, total_tax_paise, grand_total_paise)
       VALUES ($1, $2, $3, 10000, 1800, 11800) RETURNING id`,
      [businessId, financialYearId, nextNumber('INV-004')]
    );

    const creditNoteId = await insertOne(
      db,
      `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason, subtotal_paise, total_tax_paise, grand_total_paise)
       VALUES ($1, $2, $3, $4, 'Sales Return', 5000, 900, 5900) RETURNING id`,
      [businessId, invoiceId, financialYearId, nextNumber('CN-004')]
    );

    fx = { businessId, userId, financialYearId, invoiceId, creditNoteId };
  }, 60_000);

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  it('1. for all 10 constraints: invalid values are rejected with constraint name; all valid tuple values are accepted', async () => {
    // 1. businesses_subscription_plan_valid
    for (const plan of SUBSCRIPTION_PLANS) {
      await db.query(`UPDATE businesses SET subscription_plan = $1 WHERE id = $2`, [plan, fx.businessId]);
    }
    await expect(
      db.query(`UPDATE businesses SET subscription_plan = 'invalid_plan' WHERE id = $1`, [fx.businessId])
    ).rejects.toThrow(/businesses_subscription_plan_valid/);

    // 2. businesses_subscription_status_valid
    for (const status of SUBSCRIPTION_STATUSES) {
      await db.query(`UPDATE businesses SET subscription_status = $1 WHERE id = $2`, [status, fx.businessId]);
    }
    await expect(
      db.query(`UPDATE businesses SET subscription_status = 'invalid_status' WHERE id = $1`, [fx.businessId])
    ).rejects.toThrow(/businesses_subscription_status_valid/);

    // 3. businesses_default_invoice_template_valid
    for (const tmpl of INVOICE_TEMPLATE_IDS) {
      await db.query(`UPDATE businesses SET default_invoice_template = $1 WHERE id = $2`, [tmpl, fx.businessId]);
    }
    await expect(
      db.query(`UPDATE businesses SET default_invoice_template = 'template_99' WHERE id = $1`, [fx.businessId])
    ).rejects.toThrow(/businesses_default_invoice_template_valid/);

    // 4. invoices_invoice_template_valid
    for (const tmpl of INVOICE_TEMPLATE_IDS) {
      await db.query(`UPDATE invoices SET invoice_template = $1 WHERE id = $2`, [tmpl, fx.invoiceId]);
    }
    await expect(
      db.query(`UPDATE invoices SET invoice_template = 'invalid_template' WHERE id = $1`, [fx.invoiceId])
    ).rejects.toThrow(/invoices_invoice_template_valid/);

    // 5. credit_notes_status_valid
    for (const status of RECORD_STATUSES) {
      await db.query(`UPDATE credit_notes SET status = $1 WHERE id = $2`, [status, fx.creditNoteId]);
    }
    await expect(
      db.query(`UPDATE credit_notes SET status = 'cancelled' WHERE id = $1`, [fx.creditNoteId])
    ).rejects.toThrow(/credit_notes_status_valid/);

    // 6. payments_status_valid
    const paymentId = await insertOne(
      db,
      `INSERT INTO payments (business_id, invoice_id, amount_paise, payment_date, payment_method, status)
       VALUES ($1, $2, 1000, '2026-11-01', 'bank_transfer', 'active') RETURNING id`,
      [fx.businessId, fx.invoiceId]
    );
    for (const status of RECORD_STATUSES) {
      await db.query(`UPDATE payments SET status = $1 WHERE id = $2`, [status, paymentId]);
    }
    await expect(
      db.query(`UPDATE payments SET status = 'deleted' WHERE id = $1`, [paymentId])
    ).rejects.toThrow(/payments_status_valid/);

    // 7. subscription_requests_plan_name_valid
    const reqId = await insertOne(
      db,
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status)
       VALUES ($1, $2, 'essentials', 'monthly', 1000, 'upi_qr', $3, 'pending') RETURNING id`,
      [fx.businessId, fx.userId, nextNumber('REF')]
    );
    for (const plan of SUBSCRIPTION_PLANS) {
      await db.query(`UPDATE subscription_requests SET plan_name = $1 WHERE id = $2`, [plan, reqId]);
    }
    await expect(
      db.query(`UPDATE subscription_requests SET plan_name = 'platinum' WHERE id = $1`, [reqId])
    ).rejects.toThrow(/subscription_requests_plan_name_valid/);

    // 8. subscription_requests_billing_cycle_valid
    for (const cycle of REQUEST_BILLING_CYCLES) {
      await db.query(`UPDATE subscription_requests SET billing_cycle = $1 WHERE id = $2`, [cycle, reqId]);
    }
    await expect(
      db.query(`UPDATE subscription_requests SET billing_cycle = 'weekly' WHERE id = $1`, [reqId])
    ).rejects.toThrow(/subscription_requests_billing_cycle_valid/);

    // 9. subscription_requests_payment_method_valid
    for (const method of REQUEST_PAYMENT_METHODS) {
      await db.query(`UPDATE subscription_requests SET payment_method = $1 WHERE id = $2`, [method, reqId]);
    }
    await expect(
      db.query(`UPDATE subscription_requests SET payment_method = 'cash' WHERE id = $1`, [reqId])
    ).rejects.toThrow(/subscription_requests_payment_method_valid/);

    // 10. subscription_requests_status_valid
    for (const status of REQUEST_STATUSES) {
      await db.query(`UPDATE subscription_requests SET status = $1 WHERE id = $2`, [status, reqId]);
    }
    await expect(
      db.query(`UPDATE subscription_requests SET status = 'completed' WHERE id = $1`, [reqId])
    ).rejects.toThrow(/subscription_requests_status_valid/);
  });

  it('2. admin-override ledger row with manual_override billing_cycle and payment_method inserts successfully', async () => {
    const overrideRef = nextNumber('MANUAL');
    const overrideId = await insertOne(
      db,
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status)
       VALUES ($1, $2, 'free', 'manual_override', 0, 'manual_override', $3, 'approved') RETURNING id`,
      [fx.businessId, fx.userId, overrideRef]
    );
    expect(overrideId).toBeDefined();

    const read = await db.query<{ plan_name: string; billing_cycle: string; payment_method: string; status: string }>(
      `SELECT plan_name, billing_cycle, payment_method, status FROM subscription_requests WHERE id = $1`,
      [overrideId]
    );
    expect(read.rows[0]).toEqual({
      plan_name: 'free',
      billing_cycle: 'manual_override',
      payment_method: 'manual_override',
      status: 'approved',
    });
  });

  it('3. businesses.subscription_plan rejects enterprise and casing variants like Essentials', async () => {
    await expect(
      db.query(`UPDATE businesses SET subscription_plan = 'enterprise' WHERE id = $1`, [fx.businessId])
    ).rejects.toThrow(/businesses_subscription_plan_valid/);

    await expect(
      db.query(`UPDATE businesses SET subscription_plan = 'Essentials' WHERE id = $1`, [fx.businessId])
    ).rejects.toThrow(/businesses_subscription_plan_valid/);

    await expect(
      db.query(`UPDATE businesses SET subscription_plan = 'TRIAL' WHERE id = $1`, [fx.businessId])
    ).rejects.toThrow(/businesses_subscription_plan_valid/);
  });

  it('4. atomic failure: legacy invalid row causes entire DB-004 migration to fail and roll back', async () => {
    const rollbackDb = new PGlite();

    // 1. Apply up to the PREVIOUS migration
    for (const entry of readJournal()) {
      for (const statement of statementsOf(entry.tag)) {
        await rollbackDb.exec(statement);
      }
      if (entry.tag === PRE_DB004_TAG) break;
    }

    // 2. Insert a business with invalid legacy subscription_status = 'cancelled'
    const legacyBizId = await insertOne(
      rollbackDb,
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode, subscription_status)
       VALUES ('Legacy Bad Biz', '27AABCZ9999Z1Z5', '1 Old Road', 'Pune', '27', '411001', 'cancelled') RETURNING id`
    );

    // 3. Attempt DB-004 within a transaction block
    let migrationFailed = false;
    await rollbackDb.exec('BEGIN;');
    try {
      for (const statement of statementsOf(DB004_TAG)) {
        await rollbackDb.exec(statement);
      }
      await rollbackDb.exec('COMMIT;');
    } catch {
      migrationFailed = true;
      await rollbackDb.exec('ROLLBACK;');
    }

    expect(migrationFailed).toBe(true);

    // 4. Assert that NONE of the 10 DB-004 constraints exist after rollback
    const constraints = await rollbackDb.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname IN (
        'payments_status_valid',
        'credit_notes_status_valid',
        'businesses_subscription_plan_valid',
        'businesses_subscription_status_valid',
        'businesses_default_invoice_template_valid',
        'invoices_invoice_template_valid',
        'subscription_requests_plan_name_valid',
        'subscription_requests_billing_cycle_valid',
        'subscription_requests_payment_method_valid',
        'subscription_requests_status_valid'
      )`
    );
    expect(constraints.rows).toHaveLength(0);

    // 5. Assert the existing data remains intact
    const bizCheck = await rollbackDb.query<{ subscription_status: string }>(
      `SELECT subscription_status FROM businesses WHERE id = $1`,
      [legacyBizId]
    );
    expect(bizCheck.rows[0]?.subscription_status).toBe('cancelled');

    await rollbackDb.close();
  }, 60_000);

  it('5. idempotency: applying DB-004 statements a second time succeeds with no error', async () => {
    for (const statement of statementsOf(DB004_TAG)) {
      await db.exec(statement);
    }

    const conRes = await db.query<{ conname: string; convalidated: boolean }>(
      `SELECT conname, convalidated FROM pg_constraint WHERE conname IN (
        'payments_status_valid',
        'credit_notes_status_valid',
        'businesses_subscription_plan_valid',
        'businesses_subscription_status_valid',
        'businesses_default_invoice_template_valid',
        'invoices_invoice_template_valid',
        'subscription_requests_plan_name_valid',
        'subscription_requests_billing_cycle_valid',
        'subscription_requests_payment_method_valid',
        'subscription_requests_status_valid'
      )`
    );
    expect(conRes.rows).toHaveLength(10);
    for (const r of conRes.rows) {
      expect(r.convalidated).toBe(true);
    }
  });

  it('6. finalized-record immutability is preserved: finalizing an invoice and updating payment_status still succeed', async () => {
    const draftId = await insertOne(
      db,
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, subtotal_paise, total_tax_paise, grand_total_paise)
       VALUES ($1, $2, $3, 10000, 1800, 11800) RETURNING id`,
      [fx.businessId, fx.financialYearId, nextNumber('DRAFT-FINAL')]
    );

    await insertOne(
      db,
      `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, 'Item', '8471', 1.000, 'NOS', 10000, 10000, 18.00, 11800) RETURNING id`,
      [draftId]
    );

    // Finalize invoice with COMP-001 required seller snapshot
    await db.query(
      `UPDATE invoices
       SET invoice_sequence = $2,
           invoice_number = $3,
           lifecycle_status = 'finalized',
           invoice_date = '2026-10-25',
           due_date = '2026-11-24',
           finalized_at = now(),
           seller_name_snapshot = 'Acme Corp',
           seller_address_snapshot = '{"city": "Mumbai"}'::jsonb,
           seller_state_code_snapshot = '27',
           seller_snapshot_source = 'captured_at_finalization',
           seller_gstin_snapshot = '27AABCA1234A1Z5'
       WHERE id = $1`,
      [draftId, ++counter, nextNumber('INV-FINAL')]
    );

    // Updating allowed mutable column payment_status on finalized invoice succeeds
    await db.query(`UPDATE invoices SET payment_status = 'paid' WHERE id = $1`, [draftId]);

    const read = await db.query<{ payment_status: string; lifecycle_status: string }>(
      `SELECT payment_status, lifecycle_status FROM invoices WHERE id = $1`,
      [draftId]
    );
    expect(read.rows[0]?.payment_status).toBe('paid');
    expect(read.rows[0]?.lifecycle_status).toBe('finalized');

    // Updating immutable column grand_total_paise still fails via bm_invoices_guard
    await expect(
      db.query(`UPDATE invoices SET grand_total_paise = 20000 WHERE id = $1`, [draftId])
    ).rejects.toThrow(/BM_IMMUTABLE_RECORD/);
  });
});
