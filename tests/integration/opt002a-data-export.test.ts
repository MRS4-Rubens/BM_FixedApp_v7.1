import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';
import { collectDataExport } from '@/tests/helpers/collect-data-export';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

interface JournalEntry {
  tag: string;
}

function readJournal(): JournalEntry[] {
  const raw = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  return raw.entries;
}

async function applyMigrations(pg: PGlite, entries: JournalEntry[]): Promise<void> {
  for (const entry of entries) {
    const rawSql = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8');
    const statements = rawSql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await pg.exec(stmt);
    }
  }
}

interface IdRow {
  id: string;
}

async function insertOne(pg: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const result = await pg.query<IdRow>(sqlText, params);
  const row = result.rows[0];
  if (!row) throw new Error(`no row returned for: ${sqlText}`);
  return row.id;
}

describe('OPT-002a: Data Export Integration Tests (PGlite)', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  // Tenant A IDs
  let bizAId: string;
  let userAId: string;
  let fyAId: string;
  let custAId: string;
  let prodAId: string;
  let invAId: string;
  let invLineAId: string;
  let cnAId: string;
  let cnLineAId: string;
  let payAId: string;
  let subAId: string;

  // Tenant B IDs
  let bizBId: string;
  let userBId: string;
  let fyBId: string;
  let custBId: string;
  let prodBId: string;
  let invBId: string;
  let invLineBId: string;
  let cnBId: string;
  let cnLineBId: string;
  let payBId: string;
  let subBId: string;

  beforeAll(async () => {
    pg = new PGlite();
    db = drizzle(pg, { schema });
    await applyMigrations(pg, readJournal());

    // 1. Seed Business A
    bizAId = await insertOne(
      pg,
      `INSERT INTO businesses (legal_name, trade_name, gstin, pan, address_line1, city, state_code, pincode, subscription_plan, subscription_status)
       VALUES ('Alpha Logistics Pvt Ltd', 'Alpha Express', '29ABCDE1234F1Z5', 'ABCDE1234F', '12 Alpha Way', 'Bengaluru', '29', '560001', 'essentials', 'active') RETURNING id`,
    );

    userAId = await insertOne(
      pg,
      `INSERT INTO users (auth_user_id, business_id, email, display_name, role)
       VALUES ('auth_alpha_owner', $1, 'owner@alpha.dev', 'Alpha Owner', 'owner') RETURNING id`,
      [bizAId],
    );

    fyAId = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true) RETURNING id`,
      [bizAId],
    );

    custAId = await insertOne(
      pg,
      `INSERT INTO customers (business_id, name, email, state_code)
       VALUES ($1, 'Customer Alpha', 'cust@alpha.dev', '29') RETURNING id`,
      [bizAId],
    );

    prodAId = await insertOne(
      pg,
      `INSERT INTO products (business_id, name, hsn_sac_code, default_sale_price_paise)
       VALUES ($1, 'Alpha Cargo Service', '9965', 500000) RETURNING id`,
      [bizAId],
    );

    invAId = await insertOne(
      pg,
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, customer_id, lifecycle_status,
         place_of_supply_state_code, subtotal_paise, total_tax_paise, grand_total_paise, invoice_date, due_date, seller_gstin_snapshot,
         pdf_storage_key, archival_status, archival_attempts)
       VALUES ($1, $2, 'INV/2026-27/001', $3, 'draft', '29', 500000, 90000, 590000, '2026-04-10', '2026-05-10', '29ABCDE1234F1Z5',
         'archives/alpha_inv.pdf', 'archived', 1) RETURNING id`,
      [bizAId, fyAId, custAId],
    );

    invLineAId = await insertOne(
      pg,
      `INSERT INTO invoice_line_items (invoice_id, product_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
         taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, $2, 'Alpha Cargo Service Item', '9965', 1.000, 'NOS', 500000, 500000, '18.00', 590000) RETURNING id`,
      [invAId, prodAId],
    );

    await pg.query(
      `UPDATE invoices SET lifecycle_status = 'finalized', invoice_sequence = 1, finalized_at = now(),
         seller_name_snapshot = 'Alpha Logistics', seller_address_snapshot = '{"line1": "12 Alpha Way", "city": "Bengaluru", "pincode": "560001"}'::jsonb,
         seller_state_code_snapshot = '29', seller_snapshot_source = 'captured_at_finalization'
       WHERE id = $1`,
      [invAId],
    );

    cnAId = await insertOne(
      pg,
      `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason, lifecycle_status, status,
         subtotal_paise, total_tax_paise, grand_total_paise, issue_date, pdf_storage_key)
       VALUES ($1, $2, $3, 'CN/2026-27/001', '01-sales-return', 'draft', 'active', 50000, 9000, 59000, '2026-04-15', 'archives/alpha_cn.pdf') RETURNING id`,
      [bizAId, invAId, fyAId],
    );

    cnLineAId = await insertOne(
      pg,
      `INSERT INTO credit_note_line_items (credit_note_id, original_line_item_id, description, hsn_sac_code, quantity, unit_of_measurement,
         unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, $2, 'Alpha Refund Line', '9965', 0.100, 'NOS', 500000, 50000, '18.00', 59000) RETURNING id`,
      [cnAId, invLineAId],
    );

    payAId = await insertOne(
      pg,
      `INSERT INTO payments (business_id, invoice_id, amount_paise, payment_date, payment_method, reference_number, status)
       VALUES ($1, $2, 590000, '2026-04-12', 'bank_transfer', 'HDFC-ALPHA-01', 'active') RETURNING id`,
      [bizAId, invAId],
    );

    subAId = await insertOne(
      pg,
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status, screenshot_storage_key)
       VALUES ($1, $2, 'essentials', 'yearly', 118800, 'bank_transfer', 'UTR-ALPHA-01', 'approved', 'proofs/alpha.png') RETURNING id`,
      [bizAId, userAId],
    );

    // 2. Seed Business B (Victim / Distinct tenant)
    bizBId = await insertOne(
      pg,
      `INSERT INTO businesses (legal_name, trade_name, gstin, pan, address_line1, city, state_code, pincode, subscription_plan, subscription_status)
       VALUES ('Beta Technologies Pvt Ltd', 'Beta Tech', '27AABCU9603R1ZM', 'AABCU9603R', '99 Beta Blvd', 'Mumbai', '27', '400001', 'professional', 'active') RETURNING id`,
    );

    userBId = await insertOne(
      pg,
      `INSERT INTO users (auth_user_id, business_id, email, display_name, role)
       VALUES ('auth_beta_owner', $1, 'owner@beta.dev', 'Beta Owner', 'owner') RETURNING id`,
      [bizBId],
    );

    fyBId = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true) RETURNING id`,
      [bizBId],
    );

    custBId = await insertOne(
      pg,
      `INSERT INTO customers (business_id, name, email, state_code)
       VALUES ($1, 'Customer Beta', 'cust@beta.dev', '27') RETURNING id`,
      [bizBId],
    );

    prodBId = await insertOne(
      pg,
      `INSERT INTO products (business_id, name, hsn_sac_code, default_sale_price_paise)
       VALUES ($1, 'Beta Software License', '9973', 1200000) RETURNING id`,
      [bizBId],
    );

    invBId = await insertOne(
      pg,
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, customer_id, lifecycle_status,
         place_of_supply_state_code, subtotal_paise, total_tax_paise, grand_total_paise, invoice_date, due_date, seller_gstin_snapshot,
         pdf_storage_key, archival_status, archival_attempts)
       VALUES ($1, $2, 'INV/2026-27/B01', $3, 'draft', '27', 1200000, 216000, 1416000, '2026-04-11', '2026-05-11', '27AABCU9603R1ZM',
         'archives/beta_inv.pdf', 'archived', 1) RETURNING id`,
      [bizBId, fyBId, custBId],
    );

    invLineBId = await insertOne(
      pg,
      `INSERT INTO invoice_line_items (invoice_id, product_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
         taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, $2, 'Beta Software Item', '9973', 1.000, 'NOS', 1200000, 1200000, '18.00', 1416000) RETURNING id`,
      [invBId, prodBId],
    );

    await pg.query(
      `UPDATE invoices SET lifecycle_status = 'finalized', invoice_sequence = 1, finalized_at = now(),
         seller_name_snapshot = 'Beta Tech', seller_address_snapshot = '{"line1": "99 Beta Blvd", "city": "Mumbai", "pincode": "400001"}'::jsonb,
         seller_state_code_snapshot = '27', seller_snapshot_source = 'captured_at_finalization'
       WHERE id = $1`,
      [invBId],
    );

    cnBId = await insertOne(
      pg,
      `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason, lifecycle_status, status,
         subtotal_paise, total_tax_paise, grand_total_paise, issue_date, pdf_storage_key)
       VALUES ($1, $2, $3, 'CN/2026-27/B01', '01-sales-return', 'draft', 'active', 100000, 18000, 118000, '2026-04-18', 'archives/beta_cn.pdf') RETURNING id`,
      [bizBId, invBId, fyBId],
    );

    cnLineBId = await insertOne(
      pg,
      `INSERT INTO credit_note_line_items (credit_note_id, original_line_item_id, description, hsn_sac_code, quantity, unit_of_measurement,
         unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, $2, 'Beta Refund Line', '9973', 0.100, 'NOS', 1200000, 100000, '18.00', 118000) RETURNING id`,
      [cnBId, invLineBId],
    );

    payBId = await insertOne(
      pg,
      `INSERT INTO payments (business_id, invoice_id, amount_paise, payment_date, payment_method, reference_number, status)
       VALUES ($1, $2, 1416000, '2026-04-14', 'upi', 'UPI-BETA-01', 'active') RETURNING id`,
      [bizBId, invBId],
    );

    subBId = await insertOne(
      pg,
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status, screenshot_storage_key)
       VALUES ($1, $2, 'professional', 'monthly', 19900, 'upi_qr', 'UTR-BETA-01', 'approved', 'proofs/beta.png') RETURNING id`,
      [bizBId, userBId],
    );
  }, 60_000);

  afterAll(async () => {
    if (pg) {
      await pg.close();
    }
  });

  it('exports complete, valid data isolated strictly to business A', async () => {
    const { data: exportData } = await collectDataExport(db, bizAId); // API-02: the streamed file, parsed

    // Format & metadata
    expect(exportData.format).toBe('bill-matrix-data-export');
    expect(exportData.version).toBe(1);
    expect(typeof exportData.exported_at).toBe('string');
    expect(new Date(exportData.exported_at).toISOString()).toBe(exportData.exported_at);

    // Business record
    expect(exportData.business).not.toBeNull();
    expect(exportData.business?.id).toBe(bizAId);
    expect(exportData.business?.legal_name).toBe('Alpha Logistics Pvt Ltd');

    // Users
    expect(exportData.users).toHaveLength(1);
    expect(exportData.users[0].id).toBe(userAId);
    expect(exportData.users[0].business_id).toBe(bizAId);

    // Customers
    expect(exportData.customers).toHaveLength(1);
    expect(exportData.customers[0].id).toBe(custAId);
    expect(exportData.customers[0].name).toBe('Customer Alpha');

    // Products
    expect(exportData.products).toHaveLength(1);
    expect(exportData.products[0].id).toBe(prodAId);
    expect(exportData.products[0].name).toBe('Alpha Cargo Service');

    // Financial Years
    expect(exportData.financial_years).toHaveLength(1);
    expect(exportData.financial_years[0].id).toBe(fyAId);

    // Invoices with nested line items
    expect(exportData.invoices).toHaveLength(1);
    expect(exportData.invoices[0].id).toBe(invAId);
    expect(exportData.invoices[0].invoice_number).toBe('INV/2026-27/001');
    const invoiceLineItems = exportData.invoices[0].line_items as Record<string, unknown>[];
    expect(invoiceLineItems).toHaveLength(1);
    expect(invoiceLineItems[0].id).toBe(invLineAId);
    expect(invoiceLineItems[0].description).toBe('Alpha Cargo Service Item');

    // Credit notes with nested line items
    expect(exportData.credit_notes).toHaveLength(1);
    expect(exportData.credit_notes[0].id).toBe(cnAId);
    expect(exportData.credit_notes[0].credit_note_number).toBe('CN/2026-27/001');
    const creditNoteLineItems = exportData.credit_notes[0].line_items as Record<string, unknown>[];
    expect(creditNoteLineItems).toHaveLength(1);
    expect(creditNoteLineItems[0].id).toBe(cnLineAId);
    expect(creditNoteLineItems[0].description).toBe('Alpha Refund Line');

    // Payments
    expect(exportData.payments).toHaveLength(1);
    expect(exportData.payments[0].id).toBe(payAId);
    expect(exportData.payments[0].amount_paise).toBe(590000);

    // Subscription requests
    expect(exportData.subscription_requests).toHaveLength(1);
    expect(exportData.subscription_requests[0].id).toBe(subAId);
  });

  it('API-02: pages hand over exactly (same-instant rows, ties broken by id); lines stay with their invoice', async () => {
    // A separate business so the other tests' counts are untouched. Rows created in ONE statement share created_at,
    // which is the case the (created_at, id) cursor must get right.
    const bizC = await insertOne(
      pg,
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Gamma Paging Co', '29AAGCG1234K1Z5', '1 Gamma Rd', 'Mysuru', '29', '570001') RETURNING id`,
    );
    const fyC = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true) RETURNING id`,
      [bizC],
    );
    await pg.query(
      `INSERT INTO customers (business_id, name, state_code) SELECT $1, 'Gamma Customer ' || n, '29' FROM generate_series(1, 5) n`,
      [bizC],
    );
    await pg.query(
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, lifecycle_status, place_of_supply_state_code,
         subtotal_paise, total_tax_paise, grand_total_paise, invoice_date)
       SELECT $1, $2, 'DRAFT-G-' || n, 'draft', '29', 1000 * n, 0, 1000 * n, '2026-04-10' FROM generate_series(1, 7) n`,
      [bizC, fyC],
    );
    await pg.query(
      `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
         taxable_value_paise, tax_rate_percentage, line_total_paise, sort_order)
       SELECT i.id, 'Line ' || k || ' of ' || i.invoice_number, '9965', 1, 'NOS', 1000, 1000, '0.00', 1000, k
       FROM invoices i CROSS JOIN generate_series(0, 1) k WHERE i.business_id = $1`,
      [bizC],
    );

    const expectedInvoiceIds = (
      await pg.query<{ id: string }>('SELECT id FROM invoices WHERE business_id = $1 ORDER BY created_at, id', [bizC])
    ).rows.map((row) => row.id);
    const sameInstant = await pg.query<{ n: number }>(
      'SELECT count(DISTINCT created_at)::int AS n FROM invoices WHERE business_id = $1',
      [bizC],
    );
    expect(sameInstant.rows[0]?.n).toBe(1); // all 7 share one created_at

    const paged = await collectDataExport(db, bizC, { pageSize: 2 });
    expect(paged.data.invoices.map((inv) => inv.id)).toEqual(expectedInvoiceIds); // 4 pages, nothing lost or repeated
    expect(paged.data.customers).toHaveLength(5);
    for (const invoice of paged.data.invoices) {
      expect(invoice.line_items.map((line) => line.description)).toEqual([
        `Line 0 of ${String(invoice.invoice_number)}`,
        `Line 1 of ${String(invoice.invoice_number)}`,
      ]);
    }
    // One page of 500 gives the same file content (only the paging differs).
    const whole = await collectDataExport(db, bizC, { now: new Date(paged.data.exported_at) });
    expect(whole.text).toBe(paged.text);
    expect(paged.chunks).toBeGreaterThan(whole.chunks);
  });

  it('guarantees ZERO leakage of Business B identifiers or data', async () => {
    const { data: exportData } = await collectDataExport(db, bizAId); // API-02: the streamed file, parsed
    const serialized = JSON.stringify(exportData);

    const bIdentifiers = [
      bizBId,
      userBId,
      fyBId,
      custBId,
      prodBId,
      invBId,
      invLineBId,
      cnBId,
      cnLineBId,
      payBId,
      subBId,
      'auth_beta_owner',
      'owner@beta.dev',
      'Beta Technologies Pvt Ltd',
      'Customer Beta',
      'Beta Software License',
      '27AABCU9603R1ZM',
      'INV/2026-27/B01',
      'CN/2026-27/B01',
      'UPI-BETA-01',
    ];

    for (const bIdentifier of bIdentifiers) {
      expect(serialized).not.toContain(bIdentifier);
    }
  });

  it('guarantees sensitive infrastructure keys and internal columns are stripped', async () => {
    const { data: exportData } = await collectDataExport(db, bizAId); // API-02: the streamed file, parsed
    const serialized = JSON.stringify(exportData);

    const blockedKeys = [
      'auth_user_id',
      'auth_alpha_owner',
      'pdf_storage_key',
      'archives/alpha_inv.pdf',
      'archives/alpha_cn.pdf',
      'screenshot_key',
      'proofs/alpha.png',
      'archival_attempts',
      'archival_claimed_at',
      'archival_status',
      'archived_at',
    ];

    for (const key of blockedKeys) {
      expect(serialized).not.toContain(key);
    }
  });

  it('verifies amounts remain numbers/integers and dates are formatted as ISO strings', async () => {
    const { data: exportData } = await collectDataExport(db, bizAId); // API-02: the streamed file, parsed

    // Amounts
    expect(typeof exportData.invoices[0].subtotal_paise).toBe('number');
    expect(typeof exportData.invoices[0].grand_total_paise).toBe('number');
    expect(Number.isInteger(exportData.invoices[0].grand_total_paise)).toBe(true);

    const firstLine = (exportData.invoices[0].line_items as Record<string, unknown>[])[0];
    expect(typeof firstLine.unit_price_paise).toBe('number');
    expect(typeof firstLine.line_total_paise).toBe('number');

    expect(typeof exportData.payments[0].amount_paise).toBe('number');
    expect(Number.isInteger(exportData.payments[0].amount_paise)).toBe(true);

    // Dates
    expect(typeof exportData.business?.created_at).toBe('string');
    expect(typeof exportData.invoices[0].created_at).toBe('string');
  });
});
