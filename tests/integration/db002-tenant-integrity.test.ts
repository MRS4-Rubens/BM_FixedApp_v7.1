import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * DB-002 integration tests (PART A). They execute the REAL migration files on an in-process PostgreSQL (PGlite)
 * and prove that rows can never link across businesses (tenants), while normal same-tenant flows keep working.
 */

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');
const DB002_SUFFIX = '_db002_tenant_integrity';

/** The exact cross-tenant audit query given to the product owner (every count must be 0). */
const CROSS_TENANT_SCAN_SQL = `
SELECT 'invoices.customer_id -> customers' AS link, count(*)::int AS cross_tenant_rows FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE c.business_id <> i.business_id
UNION ALL SELECT 'payments.invoice_id -> invoices', count(*)::int FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.business_id <> p.business_id
UNION ALL SELECT 'credit_notes.original_invoice_id -> invoices', count(*)::int FROM credit_notes cn JOIN invoices i ON i.id = cn.original_invoice_id WHERE i.business_id <> cn.business_id
UNION ALL SELECT 'invoice_line_items.product_id -> products', count(*)::int FROM invoice_line_items li JOIN invoices i ON i.id = li.invoice_id JOIN products p ON p.id = li.product_id WHERE p.business_id <> i.business_id
UNION ALL SELECT 'credit_note_line_items.product_id -> products', count(*)::int FROM credit_note_line_items li JOIN credit_notes cn ON cn.id = li.credit_note_id JOIN products p ON p.id = li.product_id WHERE p.business_id <> cn.business_id`;

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

function resolveDb002(): { tag: string; previousTag: string } {
  const journal = readJournal();
  const position = journal.findIndex((entry) => entry.tag.endsWith(DB002_SUFFIX));
  const entry = journal[position];
  const previous = journal[position - 1];
  if (position < 1 || !entry || !previous) {
    throw new Error(`journal has no migration ending in ${DB002_SUFFIX}`);
  }
  return { tag: entry.tag, previousTag: previous.tag };
}

const { tag: DB002_TAG, previousTag: PRE_DB002_TAG } = resolveDb002();

async function applyMigrations(db: PGlite, upToAndIncludingTag: string): Promise<void> {
  for (const entry of readJournal()) {
    for (const statement of statementsOf(entry.tag)) {
      await db.exec(statement);
    }
    if (entry.tag === upToAndIncludingTag) {
      return;
    }
  }
  throw new Error(`migration ${upToAndIncludingTag} not found in journal`);
}

interface IdRow {
  id: string;
}

interface Tenant {
  businessId: string;
  financialYearId: string;
  customerId: string;
  productId: string;
}

async function insertOne(db: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const result = await db.query<IdRow>(sqlText, params);
  const row = result.rows[0];
  if (!row) {
    throw new Error(`no row returned for: ${sqlText}`);
  }
  return row.id;
}

async function createTenant(db: PGlite, gstin: string, label: string): Promise<Tenant> {
  const businessId = await insertOne(
    db,
    `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
     VALUES ($1, $2, '1 Test Road', 'Bengaluru', '29', '560001') RETURNING id`,
    [`Shop ${label}`, gstin],
  );
  const financialYearId = await insertOne(
    db,
    `INSERT INTO financial_years (business_id, label, start_date, end_date) VALUES ($1, '2026-27', '2026-04-01', '2027-03-31') RETURNING id`,
    [businessId],
  );
  const customerId = await insertOne(
    db,
    `INSERT INTO customers (business_id, name, state_code) VALUES ($1, $2, '29') RETURNING id`,
    [businessId, `Customer ${label}`],
  );
  const productId = await insertOne(
    db,
    `INSERT INTO products (business_id, name, hsn_sac_code, default_sale_price_paise) VALUES ($1, $2, '4820', 5000) RETURNING id`,
    [businessId, `Product ${label}`],
  );
  return { businessId, financialYearId, customerId, productId };
}

let counter = 0;
function nextNumber(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

async function createInvoice(db: PGlite, tenant: Tenant, customerId: string | null): Promise<string> {
  return insertOne(
    db,
    `INSERT INTO invoices (business_id, financial_year_id, invoice_number, customer_id, subtotal_paise, total_tax_paise, grand_total_paise)
     VALUES ($1, $2, $3, $4, 10000, 1800, 11800) RETURNING id`,
    [tenant.businessId, tenant.financialYearId, nextNumber('DRAFT'), customerId],
  );
}

async function createCreditNote(db: PGlite, tenant: Tenant, originalInvoiceId: string): Promise<string> {
  return insertOne(
    db,
    `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason)
     VALUES ($1, $2, $3, $4, 'Returned goods') RETURNING id`,
    [tenant.businessId, originalInvoiceId, tenant.financialYearId, nextNumber('CN')],
  );
}

async function addInvoiceLine(db: PGlite, invoiceId: string, productId: string | null): Promise<string> {
  return insertOne(
    db,
    `INSERT INTO invoice_line_items (invoice_id, product_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
     VALUES ($1, $2, 'Notebook', '4820', 2.000, 'NOS', 5000, 10000, 18.00, 11800) RETURNING id`,
    [invoiceId, productId],
  );
}

async function addCreditNoteLine(db: PGlite, creditNoteId: string, productId: string | null): Promise<string> {
  return insertOne(
    db,
    `INSERT INTO credit_note_line_items (credit_note_id, product_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
     VALUES ($1, $2, 'Notebook', '4820', 1.000, 'NOS', 5000, 5000, 18.00, 5900) RETURNING id`,
    [creditNoteId, productId],
  );
}

async function expectBlocked(operation: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(operation).rejects.toThrow(pattern);
}

interface ScanRow {
  link: string;
  cross_tenant_rows: number;
}

async function runScan(db: PGlite): Promise<Record<string, number>> {
  const result = await db.query<ScanRow>(CROSS_TENANT_SCAN_SQL);
  return Object.fromEntries(result.rows.map((row) => [row.link, row.cross_tenant_rows]));
}

describe('DB-002 (part A): cross-tenant referential integrity', () => {
  let db: PGlite;
  let tenantA: Tenant;
  let tenantB: Tenant;

  beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db, DB002_TAG);
    tenantA = await createTenant(db, '29ABCDE1234F1Z5', 'A');
    tenantB = await createTenant(db, '27ABCDE1234F1Z5', 'B');
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  describe('same-tenant links keep working', () => {
    it('accepts own customer, walk-in (NULL) customer, own invoice links and own products', async () => {
      const withCustomer = await createInvoice(db, tenantA, tenantA.customerId);
      await createInvoice(db, tenantA, null);
      await addInvoiceLine(db, withCustomer, tenantA.productId);
      await addInvoiceLine(db, withCustomer, null);
      await db.query(
        `INSERT INTO payments (business_id, invoice_id, amount_paise, payment_date, payment_method) VALUES ($1, $2, 5000, '2026-10-27', 'upi')`,
        [tenantA.businessId, withCustomer],
      );
      const creditNote = await createCreditNote(db, tenantA, withCustomer);
      await addCreditNoteLine(db, creditNote, tenantA.productId);
      await addCreditNoteLine(db, creditNote, null);
    });

    it('still lets a draft change to another customer of the SAME business', async () => {
      const second = await insertOne(db, `INSERT INTO customers (business_id, name, state_code) VALUES ($1, 'Second', '29') RETURNING id`, [tenantA.businessId]);
      const invoiceId = await createInvoice(db, tenantA, tenantA.customerId);
      await db.query(`UPDATE invoices SET customer_id = $2 WHERE id = $1`, [invoiceId, second]);
    });

    it('keeps the DB-001 lifecycle working with product-linked lines (draft -> finalize -> payment status)', async () => {
      const invoiceId = await createInvoice(db, tenantA, tenantA.customerId);
      await addInvoiceLine(db, invoiceId, tenantA.productId);
      await db.query(`UPDATE invoice_line_items SET taxable_value_paise = 10000, line_total_paise = 11800 WHERE invoice_id = $1`, [invoiceId]);
      await db.query(
        `UPDATE invoices SET invoice_sequence = $2, invoice_number = $3, lifecycle_status = 'finalized', invoice_date = '2026-10-25', finalized_at = now() WHERE id = $1`,
        [invoiceId, ++counter, nextNumber('INV')],
      );
      await db.query(`UPDATE invoices SET payment_status = 'paid', emailed_at = now(), email_send_count = 1 WHERE id = $1`, [invoiceId]);
    });
  });

  describe('cross-tenant links are rejected by the database', () => {
    it("rejects an invoice that points at another business's customer (insert and update)", async () => {
      await expectBlocked(
        db.query(
          `INSERT INTO invoices (business_id, financial_year_id, invoice_number, customer_id) VALUES ($1, $2, $3, $4)`,
          [tenantA.businessId, tenantA.financialYearId, nextNumber('XT'), tenantB.customerId],
        ),
        /invoices_customer_same_biz/,
      );
      const own = await createInvoice(db, tenantA, tenantA.customerId);
      await expectBlocked(db.query(`UPDATE invoices SET customer_id = $2 WHERE id = $1`, [own, tenantB.customerId]), /invoices_customer_same_biz/);
    });

    it("rejects a payment recorded against another business's invoice", async () => {
      const invoiceOfB = await createInvoice(db, tenantB, tenantB.customerId);
      await expectBlocked(
        db.query(
          `INSERT INTO payments (business_id, invoice_id, amount_paise, payment_date, payment_method) VALUES ($1, $2, 100, '2026-10-27', 'cash')`,
          [tenantA.businessId, invoiceOfB],
        ),
        /payments_invoice_same_biz/,
      );
    });

    it("rejects a credit note against another business's invoice", async () => {
      const invoiceOfB = await createInvoice(db, tenantB, tenantB.customerId);
      await expectBlocked(createCreditNote(db, tenantA, invoiceOfB), /credit_notes_invoice_same_biz/);
    });

    it("rejects invoice and credit-note line items that use another business's product (insert and re-point)", async () => {
      const invoiceA = await createInvoice(db, tenantA, tenantA.customerId);
      await expectBlocked(addInvoiceLine(db, invoiceA, tenantB.productId), /BM_CROSS_TENANT_REFERENCE/);
      const ownLine = await addInvoiceLine(db, invoiceA, tenantA.productId);
      await expectBlocked(db.query(`UPDATE invoice_line_items SET product_id = $2 WHERE id = $1`, [ownLine, tenantB.productId]), /BM_CROSS_TENANT_REFERENCE/);

      const creditNoteA = await createCreditNote(db, tenantA, invoiceA);
      await expectBlocked(addCreditNoteLine(db, creditNoteA, tenantB.productId), /BM_CROSS_TENANT_REFERENCE/);
      const ownCnLine = await addCreditNoteLine(db, creditNoteA, tenantA.productId);
      await expectBlocked(db.query(`UPDATE credit_note_line_items SET product_id = $2 WHERE id = $1`, [ownCnLine, tenantB.productId]), /BM_CROSS_TENANT_REFERENCE/);
    });

    it('rejects moving a product-linked line item onto an invoice of another business', async () => {
      const invoiceA = await createInvoice(db, tenantA, tenantA.customerId);
      const invoiceB = await createInvoice(db, tenantB, tenantB.customerId);
      const lineA = await addInvoiceLine(db, invoiceA, tenantA.productId);
      await expectBlocked(db.query(`UPDATE invoice_line_items SET invoice_id = $2 WHERE id = $1`, [lineA, invoiceB]), /BM_CROSS_TENANT_REFERENCE/);
    });

    it('does not block ordinary updates of a legacy cross-tenant line item (only NEW links are checked)', async () => {
      const invoiceA = await createInvoice(db, tenantA, tenantA.customerId);
      await db.exec(`ALTER TABLE invoice_line_items DISABLE TRIGGER bm_invoice_line_items_tenant`);
      const legacyLine = await addInvoiceLine(db, invoiceA, tenantB.productId);
      await db.exec(`ALTER TABLE invoice_line_items ENABLE TRIGGER bm_invoice_line_items_tenant`);
      await db.query(`UPDATE invoice_line_items SET taxable_value_paise = 9999 WHERE id = $1`, [legacyLine]);
      await db.query(`UPDATE invoice_line_items SET product_id = $2 WHERE id = $1`, [legacyLine, tenantA.productId]);
      await db.query(`DELETE FROM invoice_line_items WHERE id = $1`, [legacyLine]);
    });
  });

  describe('audit scan and migration safety', () => {
    it('the cross-tenant audit scan reports zero for clean data', async () => {
      const result = await runScan(db);
      expect(Object.keys(result)).toHaveLength(5);
      expect(Object.values(result).every((count) => count === 0)).toBe(true);
    });

    it('is idempotent and never resets a constraint that was already validated', async () => {
      const count = async (): Promise<{ uniques: number; fks: number; triggers: number }> => {
        const u = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname IN ('customers_biz_id_uq','products_biz_id_uq','invoices_biz_id_uq','credit_notes_biz_id_uq')`);
        const f = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname IN ('invoices_customer_same_biz','credit_notes_invoice_same_biz','payments_invoice_same_biz')`);
        const t = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'bm\\_%\\_tenant' AND NOT tgisinternal`);
        return { uniques: u.rows[0]?.n ?? -1, fks: f.rows[0]?.n ?? -1, triggers: t.rows[0]?.n ?? -1 };
      };
      expect(await count()).toEqual({ uniques: 4, fks: 3, triggers: 2 });
      await db.exec(`ALTER TABLE payments VALIDATE CONSTRAINT payments_invoice_same_biz`);
      for (const statement of statementsOf(DB002_TAG)) {
        await db.exec(statement);
      }
      expect(await count()).toEqual({ uniques: 4, fks: 3, triggers: 2 });
      const validated = await db.query<{ convalidated: boolean }>(`SELECT convalidated FROM pg_constraint WHERE conname = 'payments_invoice_same_biz'`);
      expect(validated.rows[0]?.convalidated).toBe(true);
    });

    it('applies cleanly on DIRTY legacy data (NOT VALID), still blocks new bad links, and VALIDATE then exposes the legacy leak', async () => {
      const legacy = new PGlite();
      try {
        await applyMigrations(legacy, PRE_DB002_TAG);
        const a = await createTenant(legacy, '29ABCDE1234F1Z5', 'LA');
        const b = await createTenant(legacy, '27ABCDE1234F1Z5', 'LB');
        // Legacy leak: an invoice of tenant A pointing at tenant B's customer (allowed by the old single-column FK).
        const leakedInvoice = await createInvoice(legacy, a, b.customerId);

        await legacy.transaction(async (tx) => {
          for (const statement of statementsOf(DB002_TAG)) {
            await tx.exec(statement);
          }
        });

        const scan = await runScan(legacy);
        expect(scan['invoices.customer_id -> customers']).toBe(1);

        await expectBlocked(createInvoice(legacy, a, b.customerId), /invoices_customer_same_biz/);
        await expectBlocked(legacy.exec(`ALTER TABLE invoices VALIDATE CONSTRAINT invoices_customer_same_biz`), /invoices_customer_same_biz/);

        // Quarantine fix (what a human would do): detach the leaked link, then validation succeeds.
        await legacy.query(`UPDATE invoices SET customer_id = NULL WHERE id = $1`, [leakedInvoice]);
        await legacy.exec(`ALTER TABLE invoices VALIDATE CONSTRAINT invoices_customer_same_biz`);
      } finally {
        await legacy.close();
      }
    }, 120_000);
  });
});
