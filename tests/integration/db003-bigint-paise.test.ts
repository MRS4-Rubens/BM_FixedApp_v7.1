import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

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

interface IdRow {
  id: string;
}

interface Fixture {
  businessId: string;
  financialYearId: string;
}

let counter = 0;
function nextNumber(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

async function insertOne(db: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const result = await db.query<IdRow>(sqlText, params);
  const row = result.rows[0];
  if (!row) {
    throw new Error(`no row returned for: ${sqlText}`);
  }
  return row.id;
}

describe('DB-003 bigint paise migration and constraints integration (PGlite)', () => {
  let db: PGlite;
  let fx: Fixture;
  let draftInvoiceId: string;
  let draftLineItemId: string;

  beforeAll(async () => {
    db = new PGlite();

    // 1. Upgrade path: apply migrations 0000 up to and including 0018
    const journal = readJournal();
    const entry0018 = journal.find((e) => e.idx === 18);
    if (!entry0018) {
      throw new Error('migration 0018 not found in journal');
    }

    for (const entry of journal) {
      if (entry.idx > 18) break;
      for (const statement of statementsOf(entry.tag)) {
        await db.exec(statement);
      }
    }

    // Insert baseline fixture data
    const businessId = await insertOne(
      db,
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Tech Corp India', '27AABCU9603R1ZM', '10 Tech Park', 'Mumbai', '27', '400001') RETURNING id`
    );

    const financialYearId = await insertOne(
      db,
      `INSERT INTO financial_years (business_id, label, start_date, end_date)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31') RETURNING id`,
      [businessId]
    );

    fx = { businessId, financialYearId };

    // Insert a draft invoice with subtotal 10000 / tax 1800 / grand 11800 and one line item
    draftInvoiceId = await insertOne(
      db,
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, subtotal_paise, total_tax_paise, grand_total_paise)
       VALUES ($1, $2, $3, 10000, 1800, 11800) RETURNING id`,
      [fx.businessId, fx.financialYearId, nextNumber('DRAFT-003')]
    );

    draftLineItemId = await insertOne(
      db,
      `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, 'Widget', '8471', 2.000, 'NOS', 5000, 10000, 18.00, 11800) RETURNING id`,
      [draftInvoiceId]
    );

    // Apply migration 0019
    const entry0019 = journal.find((e) => e.idx === 19);
    if (!entry0019) {
      throw new Error('migration 0019 not found in journal');
    }

    for (const statement of statementsOf(entry0019.tag)) {
      await db.exec(statement);
    }
  }, 60_000);

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  it('1. upgrade path preserves existing data across the type widening', async () => {
    interface InvoiceRow {
      subtotal_paise: unknown;
      total_tax_paise: unknown;
      grand_total_paise: unknown;
    }
    const invRes = await db.query<InvoiceRow>(
      `SELECT subtotal_paise, total_tax_paise, grand_total_paise FROM invoices WHERE id = $1`,
      [draftInvoiceId]
    );
    const inv = invRes.rows[0];
    expect(inv).toBeDefined();
    if (inv) {
      expect(Number(inv.subtotal_paise)).toBe(10000);
      expect(Number(inv.total_tax_paise)).toBe(1800);
      expect(Number(inv.grand_total_paise)).toBe(11800);
    }

    interface LineRow {
      unit_price_paise: unknown;
      taxable_value_paise: unknown;
      line_total_paise: unknown;
    }
    const lineRes = await db.query<LineRow>(
      `SELECT unit_price_paise, taxable_value_paise, line_total_paise FROM invoice_line_items WHERE id = $1`,
      [draftLineItemId]
    );
    const line = lineRes.rows[0];
    expect(line).toBeDefined();
    if (line) {
      expect(Number(line.unit_price_paise)).toBe(5000);
      expect(Number(line.taxable_value_paise)).toBe(10000);
      expect(Number(line.line_total_paise)).toBe(11800);
    }
  });

  it('2. all 27 document *_paise columns are bigint and the 2 intentional exceptions are integer', async () => {
    interface ColumnRow {
      table_name: string;
      column_name: string;
      data_type: string;
    }
    const res = await db.query<ColumnRow>(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name LIKE '%\\_paise' ESCAPE '\\'
       ORDER BY table_name, column_name`
    );

    const typeMap = new Map<string, string>();
    for (const r of res.rows) {
      typeMap.set(`${r.table_name}.${r.column_name}`, r.data_type);
    }

    const expectedBigIntColumns = [
      // invoices (6)
      'invoices.subtotal_paise',
      'invoices.total_cgst_paise',
      'invoices.total_sgst_paise',
      'invoices.total_igst_paise',
      'invoices.total_tax_paise',
      'invoices.grand_total_paise',
      // credit_notes (6)
      'credit_notes.subtotal_paise',
      'credit_notes.total_cgst_paise',
      'credit_notes.total_sgst_paise',
      'credit_notes.total_igst_paise',
      'credit_notes.total_tax_paise',
      'credit_notes.grand_total_paise',
      // payments (1)
      'payments.amount_paise',
      // invoice_line_items (7)
      'invoice_line_items.unit_price_paise',
      'invoice_line_items.discount_paise',
      'invoice_line_items.taxable_value_paise',
      'invoice_line_items.cgst_paise',
      'invoice_line_items.sgst_paise',
      'invoice_line_items.igst_paise',
      'invoice_line_items.line_total_paise',
      // credit_note_line_items (7)
      'credit_note_line_items.unit_price_paise',
      'credit_note_line_items.discount_paise',
      'credit_note_line_items.taxable_value_paise',
      'credit_note_line_items.cgst_paise',
      'credit_note_line_items.sgst_paise',
      'credit_note_line_items.igst_paise',
      'credit_note_line_items.line_total_paise',
    ];

    expect(expectedBigIntColumns).toHaveLength(27);
    for (const col of expectedBigIntColumns) {
      expect(typeMap.get(col)).toBe('bigint');
    }

    // 2 allow-listed integer columns
    expect(typeMap.get('products.default_sale_price_paise')).toBe('integer');
    expect(typeMap.get('subscription_requests.amount_paise')).toBe('integer');
  });

  it('3. accepts and persists large values (> 32-bit int4) accurately', async () => {
    // ₹5 crore invoice: grand_total_paise = 5,900,000,000 > 2^31
    await db.query(
      `UPDATE invoices
       SET subtotal_paise = 5000000000, total_tax_paise = 900000000, grand_total_paise = 5900000000
       WHERE id = $1`,
      [draftInvoiceId]
    );

    await db.query(
      `UPDATE invoice_line_items
       SET unit_price_paise = 500000000, taxable_value_paise = 5000000000, line_total_paise = 5900000000
       WHERE id = $1`,
      [draftLineItemId]
    );

    interface InvoiceCheckRow {
      grand_total_paise: unknown;
    }
    const invRes = await db.query<InvoiceCheckRow>(
      `SELECT grand_total_paise FROM invoices WHERE id = $1`,
      [draftInvoiceId]
    );
    const grandTotal = Number(invRes.rows[0]?.grand_total_paise);
    expect(grandTotal).toBe(5_900_000_000);
    expect(Number.isSafeInteger(grandTotal)).toBe(true);
    expect(grandTotal).toBeGreaterThan(2_147_483_647);
  });

  it('4. JS-safe CHECK constraints reject values > Number.MAX_SAFE_INTEGER and accept Number.MAX_SAFE_INTEGER', async () => {
    const UNSAFE_VALUE = '9007199254740992'; // 2^53
    const SAFE_MAX_VALUE = '9007199254740991'; // Number.MAX_SAFE_INTEGER

    // 1. invoices
    await expect(
      db.query(`UPDATE invoices SET grand_total_paise = ${UNSAFE_VALUE} WHERE id = $1`, [draftInvoiceId])
    ).rejects.toThrow(/invoices_paise_js_safe/);

    // 2. invoice_line_items
    await expect(
      db.query(`UPDATE invoice_line_items SET line_total_paise = ${UNSAFE_VALUE} WHERE id = $1`, [draftLineItemId])
    ).rejects.toThrow(/ili_paise_js_safe/);

    // 3. payments
    await expect(
      db.query(
        `INSERT INTO payments (business_id, invoice_id, amount_paise, payment_date, payment_method)
         VALUES ($1, $2, ${UNSAFE_VALUE}, '2026-11-01', 'bank_transfer')`,
        [fx.businessId, draftInvoiceId]
      )
    ).rejects.toThrow(/payments_amount_js_safe/);

    // 4. credit_notes
    const draftCnId = await insertOne(
      db,
      `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason, subtotal_paise, total_tax_paise, grand_total_paise)
       VALUES ($1, $2, $3, $4, 'Price adjustment', 1000, 180, 1180) RETURNING id`,
      [fx.businessId, draftInvoiceId, fx.financialYearId, nextNumber('CNDRAFT-003')]
    );

    await expect(
      db.query(`UPDATE credit_notes SET grand_total_paise = ${UNSAFE_VALUE} WHERE id = $1`, [draftCnId])
    ).rejects.toThrow(/credit_notes_paise_js_safe/);

    // 5. credit_note_line_items
    await expect(
      db.query(
        `INSERT INTO credit_note_line_items (credit_note_id, original_line_item_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
         VALUES ($1, $2, 'Widget Credit', '8471', 1.000, 'NOS', ${UNSAFE_VALUE}, 1000, 18.00, 1180)`,
        [draftCnId, draftLineItemId]
      )
    ).rejects.toThrow(/cnli_paise_js_safe/);

    // Accept exactly Number.MAX_SAFE_INTEGER
    await db.query(
      `UPDATE invoices SET grand_total_paise = ${SAFE_MAX_VALUE} WHERE id = $1`,
      [draftInvoiceId]
    );
    const readSafe = await db.query<{ grand_total_paise: unknown }>(
      `SELECT grand_total_paise FROM invoices WHERE id = $1`,
      [draftInvoiceId]
    );
    expect(Number(readSafe.rows[0]?.grand_total_paise)).toBe(9007199254740991);
  });

  it('5. existing non-negative and positive CHECK constraints survived the rebuild', async () => {
    // invoices_money_nonneg rejects negative
    await expect(
      db.query(`UPDATE invoices SET grand_total_paise = -1 WHERE id = $1`, [draftInvoiceId])
    ).rejects.toThrow(/invoices_money_nonneg/);

    // payments_amount_positive rejects 0
    await expect(
      db.query(
        `INSERT INTO payments (business_id, invoice_id, amount_paise, payment_date, payment_method)
         VALUES ($1, $2, 0, '2026-11-01', 'bank_transfer')`,
        [fx.businessId, draftInvoiceId]
      )
    ).rejects.toThrow(/payments_amount_positive/);

    // Verify all 5 non-negative / positive constraints exist and are validated in pg_constraint
    interface ConstraintRow {
      conname: string;
      convalidated: boolean;
    }
    const conRes = await db.query<ConstraintRow>(
      `SELECT conname, convalidated FROM pg_constraint
       WHERE conname IN ('invoices_money_nonneg', 'credit_notes_money_nonneg', 'payments_amount_positive', 'ili_nonneg', 'cnli_nonneg')`
    );
    expect(conRes.rows).toHaveLength(5);
    for (const r of conRes.rows) {
      expect(r.convalidated).toBe(true);
    }
  });

  it('6. immutability triggers still fire after the column type change', async () => {
    // Reset draft invoice to reasonable totals
    await db.query(
      `UPDATE invoices SET subtotal_paise = 10000, total_tax_paise = 1800, grand_total_paise = 11800 WHERE id = $1`,
      [draftInvoiceId]
    );

    // Finalize invoice (fulfills DB-001 and COMP-001 seller snapshot constraints)
    await db.query(
      `UPDATE invoices
       SET invoice_sequence = $2,
           invoice_number = $3,
           lifecycle_status = 'finalized',
           invoice_date = '2026-10-25',
           due_date = '2026-11-24',
           finalized_at = now(),
           seller_name_snapshot = 'Tech Corp India',
           seller_address_snapshot = '{"line1": "10 Tech Park", "city": "Mumbai"}'::jsonb,
           seller_state_code_snapshot = '27',
           seller_snapshot_source = 'captured_at_finalization',
           seller_gstin_snapshot = '27AABCU9603R1ZM'
       WHERE id = $1`,
      [draftInvoiceId, ++counter, nextNumber('INV-003')]
    );

    // Updating grand_total_paise on a finalized invoice must be blocked by bm_invoices_guard
    await expect(
      db.query(`UPDATE invoices SET grand_total_paise = 12000 WHERE id = $1`, [draftInvoiceId])
    ).rejects.toThrow(/BM_IMMUTABLE_RECORD/);

    // Verify trigger existence and enabled state in pg_trigger
    interface TriggerRow {
      tgname: string;
      tgenabled: string;
    }
    const trigRes = await db.query<TriggerRow>(
      `SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'bm_invoices_guard'`
    );
    expect(trigRes.rows).toHaveLength(1);
    expect(trigRes.rows[0]?.tgenabled).toBe('O'); // 'O' = origin and local
  });

  it('7. migration 0019 shape: contains exactly 27 SET DATA TYPE bigint, 5 _js_safe checks, lock_timeout, and no DROP', () => {
    const journal = readJournal();
    const entry0019 = journal.find((e) => e.idx === 19);
    expect(entry0019).toBeDefined();

    const sqlContent = readFileSync(join(DRIZZLE_DIR, `${entry0019?.tag}.sql`), 'utf8');

    const typeChanges = (sqlContent.match(/SET DATA TYPE bigint/g) || []).length;
    expect(typeChanges).toBe(27);

    const jsSafeChecks = (sqlContent.match(/_js_safe/g) || []).length;
    expect(jsSafeChecks).toBe(5);

    expect(sqlContent).toContain("SET LOCAL lock_timeout = '15s'");
    expect(sqlContent.toUpperCase()).not.toContain('DROP');
  });
});
