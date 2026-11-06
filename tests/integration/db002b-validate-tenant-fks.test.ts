import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * DB-002 PART B integration tests: the composite tenant foreign keys are VALIDATED against existing rows and the three
 * redundant single-column foreign keys are removed. Runs the REAL migrations on an in-process PostgreSQL (PGlite).
 */

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');
const PART_A_SUFFIX = '_db002_tenant_integrity';
const PART_B_SUFFIX = '_db002b_validate_tenant_fks';

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

function resolve(): { partA: string; partB: string } {
  const journal = readJournal();
  const partA = journal.find((entry) => entry.tag.endsWith(PART_A_SUFFIX));
  const partB = journal.find((entry) => entry.tag.endsWith(PART_B_SUFFIX));
  if (!partA || !partB || partB.idx <= partA.idx) {
    throw new Error('journal must contain DB-002 part A followed by part B');
  }
  return { partA: partA.tag, partB: partB.tag };
}

const { partA: PART_A_TAG, partB: PART_B_TAG } = resolve();

/** Applies journal entries [from, to] (inclusive, by tag). `from` null = from the very first migration. */
async function applyRange(db: PGlite, fromTag: string | null, toTag: string): Promise<void> {
  let started = fromTag === null;
  for (const entry of readJournal()) {
    if (!started && entry.tag === fromTag) {
      started = true;
    }
    if (started) {
      for (const statement of statementsOf(entry.tag)) {
        await db.exec(statement);
      }
    }
    if (entry.tag === toTag) {
      return;
    }
  }
  throw new Error(`migration ${toTag} not found in journal`);
}

function previousTagOf(tag: string): string {
  const journal = readJournal();
  const position = journal.findIndex((entry) => entry.tag === tag);
  const previous = journal[position - 1];
  if (position < 1 || !previous) {
    throw new Error(`no migration before ${tag}`);
  }
  return previous.tag;
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
    `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode) VALUES ($1, $2, '1 Test Road', 'Bengaluru', '29', '560001') RETURNING id`,
    [`Shop ${label}`, gstin],
  );
  const financialYearId = await insertOne(
    db,
    `INSERT INTO financial_years (business_id, label, start_date, end_date) VALUES ($1, '2026-27', '2026-04-01', '2027-03-31') RETURNING id`,
    [businessId],
  );
  const customerId = await insertOne(db, `INSERT INTO customers (business_id, name, state_code) VALUES ($1, $2, '29') RETURNING id`, [businessId, `Customer ${label}`]);
  const productId = await insertOne(db, `INSERT INTO products (business_id, name, hsn_sac_code, default_sale_price_paise) VALUES ($1, $2, '4820', 5000) RETURNING id`, [businessId, `Product ${label}`]);
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
    `INSERT INTO invoices (business_id, financial_year_id, invoice_number, customer_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenant.businessId, tenant.financialYearId, nextNumber('DRAFT'), customerId],
  );
}

async function createPayment(db: PGlite, businessId: string, invoiceId: string): Promise<void> {
  await db.query(
    `INSERT INTO payments (business_id, invoice_id, amount_paise, payment_date, payment_method) VALUES ($1, $2, 100, '2026-10-27', 'cash')`,
    [businessId, invoiceId],
  );
}

async function createCreditNote(db: PGlite, tenant: Tenant, originalInvoiceId: string): Promise<string> {
  return insertOne(
    db,
    `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason) VALUES ($1, $2, $3, $4, 'x') RETURNING id`,
    [tenant.businessId, originalInvoiceId, tenant.financialYearId, nextNumber('CN')],
  );
}

async function expectBlocked(operation: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(operation).rejects.toThrow(pattern);
}

interface ConstraintRow {
  conname: string;
  convalidated: boolean;
}

async function constraintState(db: PGlite, names: string[]): Promise<Record<string, boolean>> {
  const result = await db.query<ConstraintRow>(`SELECT conname, convalidated FROM pg_constraint WHERE conname = ANY($1::text[])`, [names]);
  return Object.fromEntries(result.rows.map((row) => [row.conname, row.convalidated]));
}

const COMPOSITE_KEYS = ['invoices_customer_same_biz', 'credit_notes_invoice_same_biz', 'payments_invoice_same_biz'];
const REDUNDANT_KEYS = [
  'invoices_customer_id_customers_id_fk',
  'credit_notes_original_invoice_id_invoices_id_fk',
  'payments_invoice_id_invoices_id_fk',
];
const KEPT_PRODUCT_KEYS = [
  'invoice_line_items_product_id_products_id_fk',
  'credit_note_line_items_product_id_products_id_fk',
];

describe('DB-002 part B: validated composite tenant keys, redundant keys removed', () => {
  describe('safety net', () => {
    it('refuses to drop the old keys when the composite keys are not validated (even if VALIDATE were removed)', async () => {
      const db = new PGlite();
      try {
        await applyRange(db, null, PART_A_TAG);
        const withoutValidate = statementsOf(PART_B_TAG).filter((statement) => !/VALIDATE CONSTRAINT/.test(statement));
        expect(withoutValidate.length).toBeLessThan(statementsOf(PART_B_TAG).length);
        await expect(
          db.transaction(async (tx) => {
            for (const statement of withoutValidate) {
              await tx.exec(statement);
            }
          }),
        ).rejects.toThrow(/part B refused/);
        expect(Object.keys(await constraintState(db, REDUNDANT_KEYS)).sort()).toEqual([...REDUNDANT_KEYS].sort());
      } finally {
        await db.close();
      }
    }, 120_000);
  });

  describe('on clean data', () => {
    let db: PGlite;
    let a: Tenant;
    let b: Tenant;

    beforeAll(async () => {
      db = new PGlite();
      await applyRange(db, null, PART_B_TAG);
      a = await createTenant(db, '29ABCDE1234F1Z5', 'A');
      b = await createTenant(db, '27ABCDE1234F1Z5', 'B');
    }, 120_000);

    afterAll(async () => {
      await db.close();
    });

    it('validates the three composite keys, removes the three redundant keys and KEEPS the two product keys', async () => {
      expect(await constraintState(db, COMPOSITE_KEYS)).toEqual({
        invoices_customer_same_biz: true,
        credit_notes_invoice_same_biz: true,
        payments_invoice_same_biz: true,
      });
      expect(await constraintState(db, REDUNDANT_KEYS)).toEqual({});
      expect(Object.keys(await constraintState(db, KEPT_PRODUCT_KEYS)).sort()).toEqual([...KEPT_PRODUCT_KEYS].sort());
    });

    it('keeps normal same-business flows working (own customer, walk-in, payment, credit note)', async () => {
      const invoiceId = await createInvoice(db, a, a.customerId);
      await createInvoice(db, a, null);
      await createPayment(db, a.businessId, invoiceId);
      await createCreditNote(db, a, invoiceId);
    });

    it('still rejects links to another business (customer, payment, credit note)', async () => {
      const invoiceOfB = await createInvoice(db, b, b.customerId);
      await expectBlocked(createInvoice(db, a, b.customerId), /invoices_customer_same_biz/);
      await expectBlocked(createPayment(db, a.businessId, invoiceOfB), /payments_invoice_same_biz/);
      await expectBlocked(createCreditNote(db, a, invoiceOfB), /credit_notes_invoice_same_biz/);
    });

    it('still rejects links to rows that do not exist at all (the old keys are no longer needed for that)', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';
      await expectBlocked(createInvoice(db, a, missing), /invoices_customer_same_biz/);
      await expectBlocked(createPayment(db, a.businessId, missing), /payments_invoice_same_biz/);
      await expectBlocked(createCreditNote(db, a, missing), /credit_notes_invoice_same_biz/);
    });

    it('still refuses to delete a customer or invoice that other rows depend on', async () => {
      const customerId = await insertOne(db, `INSERT INTO customers (business_id, name, state_code) VALUES ($1, 'Doomed', '29') RETURNING id`, [a.businessId]);
      const invoiceId = await createInvoice(db, a, customerId);
      await expectBlocked(db.query(`DELETE FROM customers WHERE id = $1`, [customerId]), /invoices_customer_same_biz/);
      await createPayment(db, a.businessId, invoiceId);
      await expectBlocked(db.query(`DELETE FROM invoices WHERE id = $1`, [invoiceId]), /payments_invoice_same_biz/);
    });

    it('still rejects another business\'s product on a line item (trigger) and keeps product references intact', async () => {
      const invoiceId = await createInvoice(db, a, a.customerId);
      await expectBlocked(
        db.query(
          `INSERT INTO invoice_line_items (invoice_id, product_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
           VALUES ($1, $2, 'x', '4820', 1, 'NOS', 1, 1, 18, 1)`,
          [invoiceId, b.productId],
        ),
        /BM_CROSS_TENANT_REFERENCE/,
      );
      await expectBlocked(
        db.query(
          `INSERT INTO invoice_line_items (invoice_id, product_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
           VALUES ($1, '00000000-0000-4000-8000-000000000000', 'x', '4820', 1, 'NOS', 1, 1, 18, 1)`,
          [invoiceId],
        ),
        /invoice_line_items_product_id_products_id_fk/,
      );
    });

    it('is idempotent: running part B again changes nothing and does not fail', async () => {
      for (const statement of statementsOf(PART_B_TAG)) {
        await db.exec(statement);
      }
      expect(await constraintState(db, COMPOSITE_KEYS)).toEqual({
        invoices_customer_same_biz: true,
        credit_notes_invoice_same_biz: true,
        payments_invoice_same_biz: true,
      });
      expect(await constraintState(db, REDUNDANT_KEYS)).toEqual({});
    });
  });

  describe('on DIRTY legacy data (a cross-tenant row that existed before DB-002)', () => {
    const scenarios: Array<{ label: string; plant: (db: PGlite, a: Tenant, b: Tenant) => Promise<string>; fix: string; failing: RegExp; oldKey: string }> = [
      {
        label: "an invoice pointing at another business's customer",
        plant: async (db, a, b) => createInvoice(db, a, b.customerId),
        fix: `UPDATE invoices SET customer_id = NULL WHERE id = $1`,
        failing: /invoices_customer_same_biz/,
        oldKey: 'invoices_customer_id_customers_id_fk',
      },
      {
        label: "a payment recorded against another business's invoice",
        plant: async (db, a, b) => {
          const invoiceOfB = await createInvoice(db, b, b.customerId);
          await createPayment(db, a.businessId, invoiceOfB);
          return invoiceOfB;
        },
        fix: `DELETE FROM payments WHERE invoice_id = $1`,
        failing: /payments_invoice_same_biz/,
        oldKey: 'payments_invoice_id_invoices_id_fk',
      },
      {
        label: "a credit note against another business's invoice",
        plant: async (db, a, b) => {
          const invoiceOfB = await createInvoice(db, b, b.customerId);
          await createCreditNote(db, a, invoiceOfB);
          return invoiceOfB;
        },
        fix: `DELETE FROM credit_notes WHERE original_invoice_id = $1`,
        failing: /credit_notes_invoice_same_biz/,
        oldKey: 'credit_notes_original_invoice_id_invoices_id_fk',
      },
    ];

    it.each(scenarios)(
      'refuses atomically for $label, changes nothing, and succeeds after the leak is quarantined',
      async ({ plant, fix, failing, oldKey }) => {
        const db = new PGlite();
        try {
          // Schema BEFORE part A (leaks are still possible) -> plant the legacy leak -> apply part A (NOT VALID keys).
          await applyRange(db, null, previousTagOf(PART_A_TAG));
          const a = await createTenant(db, '29ABCDE1234F1Z5', 'LA');
          const b = await createTenant(db, '27ABCDE1234F1Z5', 'LB');
          const leakedKey = await plant(db, a, b);
          await applyRange(db, PART_A_TAG, PART_A_TAG);

          await expect(
            db.transaction(async (tx) => {
              for (const statement of statementsOf(PART_B_TAG)) {
                await tx.exec(statement);
              }
            }),
          ).rejects.toThrow(failing);

          // Atomic: the old key is still there and the composite keys are still unvalidated.
          expect(Object.keys(await constraintState(db, [oldKey]))).toEqual([oldKey]);
          expect(Object.values(await constraintState(db, COMPOSITE_KEYS)).every((validated) => validated === false)).toBe(true);

          // Quarantine the leak (what a human would do), then part B succeeds.
          await db.query(fix, [leakedKey]);
          await db.transaction(async (tx) => {
            for (const statement of statementsOf(PART_B_TAG)) {
              await tx.exec(statement);
            }
          });
          expect(await constraintState(db, [oldKey])).toEqual({});
          expect(Object.values(await constraintState(db, COMPOSITE_KEYS)).every((validated) => validated === true)).toBe(true);
        } finally {
          await db.close();
        }
      },
      120_000,
    );
  });
});
