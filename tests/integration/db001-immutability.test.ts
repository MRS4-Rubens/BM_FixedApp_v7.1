import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * DB-001 integration tests. They execute the REAL migration files (drizzle/0000 ... DB-001) on an in-process
 * PostgreSQL (PGlite), so the CHECK constraints and immutability triggers are tested exactly as written,
 * with no external database. If you add a legitimate post-finalization write to a NEW column, update the
 * trigger function in a new migration AND the allow-list expectations here.
 */

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');
const DB001_SUFFIX = '_db001_constraints_and_immutability';

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

function resolveDb001(): { tag: string; previousTag: string } {
  const journal = readJournal();
  const position = journal.findIndex((entry) => entry.tag.endsWith(DB001_SUFFIX));
  const entry = journal[position];
  const previous = journal[position - 1];
  if (position < 1 || !entry || !previous) {
    throw new Error(`journal has no migration ending in ${DB001_SUFFIX}`);
  }
  return { tag: entry.tag, previousTag: previous.tag };
}

const { tag: DB001_TAG, previousTag: PRE_DB001_TAG } = resolveDb001();

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

interface Fixture {
  businessId: string;
  financialYearId: string;
}

async function insertOne(db: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const result = await db.query<IdRow>(sqlText, params);
  const row = result.rows[0];
  if (!row) {
    throw new Error(`no row returned for: ${sqlText}`);
  }
  return row.id;
}

async function createFixture(db: PGlite): Promise<Fixture> {
  const businessId = await insertOne(
    db,
    `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
     VALUES ('Test Shop', '29ABCDE1234F1Z5', '1 Test Road', 'Bengaluru', '29', '560001') RETURNING id`,
  );
  const financialYearId = await insertOne(
    db,
    `INSERT INTO financial_years (business_id, label, start_date, end_date)
     VALUES ($1, '2026-27', '2026-04-01', '2027-03-31') RETURNING id`,
    [businessId],
  );
  return { businessId, financialYearId };
}

let counter = 0;
function nextNumber(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

async function createDraftInvoice(db: PGlite, fx: Fixture): Promise<string> {
  return insertOne(
    db,
    `INSERT INTO invoices (business_id, financial_year_id, invoice_number, subtotal_paise, total_tax_paise, grand_total_paise)
     VALUES ($1, $2, $3, 10000, 1800, 11800) RETURNING id`,
    [fx.businessId, fx.financialYearId, nextNumber('DRAFT')],
  );
}

async function addInvoiceLine(db: PGlite, invoiceId: string): Promise<string> {
  return insertOne(
    db,
    `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
     VALUES ($1, 'Notebook', '4820', 2.000, 'NOS', 5000, 10000, 18.00, 11800) RETURNING id`,
    [invoiceId],
  );
}

async function finalizeInvoice(db: PGlite, invoiceId: string): Promise<void> {
  // Mirrors lib/actions/invoices/finalize-invoice.ts: line items are touched while the invoice is still a draft,
  // then ONE update moves the invoice to 'finalized'.
  await db.query(`UPDATE invoice_line_items SET taxable_value_paise = 10000 WHERE invoice_id = $1`, [invoiceId]);
  await db.query(
    `UPDATE invoices SET invoice_sequence = $2, invoice_number = $3, lifecycle_status = 'finalized',
       invoice_date = '2026-10-25', due_date = '2026-11-24', finalized_at = now(),
       seller_gstin_snapshot = '29ABCDE1234F1Z5', grand_total_paise = 11800
     WHERE id = $1`,
    [invoiceId, ++counter, nextNumber('INV')],
  );
}

async function createFinalizedCreditNote(db: PGlite, fx: Fixture, invoiceId: string): Promise<string> {
  const draftId = await insertOne(
    db,
    `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason, subtotal_paise, total_tax_paise, grand_total_paise)
     VALUES ($1, $2, $3, $4, 'Returned goods', 5000, 900, 5900) RETURNING id`,
    [fx.businessId, invoiceId, fx.financialYearId, nextNumber('CNDRAFT')],
  );
  await db.query(
    `INSERT INTO credit_note_line_items (credit_note_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
     VALUES ($1, 'Notebook', '4820', 1.000, 'NOS', 5000, 5000, 18.00, 5900)`,
    [draftId],
  );
  await db.query(
    `UPDATE credit_notes SET credit_note_sequence = $2, credit_note_number = $3, lifecycle_status = 'finalized',
       issue_date = '2026-10-26', finalized_at = now() WHERE id = $1`,
    [draftId, ++counter, nextNumber('CN')],
  );
  return draftId;
}

async function expectBlocked(operation: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(operation).rejects.toThrow(pattern);
}

describe('DB-001: CHECK constraints and immutability of finalized records', () => {
  let db: PGlite;
  let fx: Fixture;

  beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db, DB001_TAG);
    fx = await createFixture(db);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  describe('CHECK constraints', () => {
    it('rejects negative invoice money', async () => {
      await expectBlocked(
        db.query(
          `INSERT INTO invoices (business_id, financial_year_id, invoice_number, grand_total_paise) VALUES ($1, $2, $3, -1)`,
          [fx.businessId, fx.financialYearId, nextNumber('NEG')],
        ),
        /invoices_money_nonneg/,
      );
    });

    it('rejects a finalized invoice without sequence, finalized_at or invoice_date', async () => {
      await expectBlocked(
        db.query(
          `INSERT INTO invoices (business_id, financial_year_id, invoice_number, lifecycle_status) VALUES ($1, $2, $3, 'finalized')`,
          [fx.businessId, fx.financialYearId, nextNumber('NOSEQ')],
        ),
        /invoices_final_requires_number/,
      );
    });

    it('rejects a finalized credit note without number data and negative credit-note money', async () => {
      const invoiceId = await createDraftInvoice(db, fx);
      await expectBlocked(
        db.query(
          `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason, lifecycle_status)
           VALUES ($1, $2, $3, $4, 'x', 'finalized')`,
          [fx.businessId, invoiceId, fx.financialYearId, nextNumber('CNBAD')],
        ),
        /credit_notes_final_requires_number/,
      );
      await expectBlocked(
        db.query(
          `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason, grand_total_paise)
           VALUES ($1, $2, $3, $4, 'x', -5)`,
          [fx.businessId, invoiceId, fx.financialYearId, nextNumber('CNNEG')],
        ),
        /credit_notes_money_nonneg/,
      );
    });

    it('rejects zero or negative payments', async () => {
      const invoiceId = await createDraftInvoice(db, fx);
      for (const amount of [0, -100]) {
        await expectBlocked(
          db.query(
            `INSERT INTO payments (business_id, invoice_id, amount_paise, payment_date, payment_method) VALUES ($1, $2, $3, '2026-10-25', 'cash')`,
            [fx.businessId, invoiceId, amount],
          ),
          /payments_amount_positive/,
        );
      }
      await db.query(
        `INSERT INTO payments (business_id, invoice_id, amount_paise, payment_date, payment_method) VALUES ($1, $2, 1, '2026-10-25', 'cash')`,
        [fx.businessId, invoiceId],
      );
    });

    it('rejects invalid line items (zero quantity, negative price/discount/taxable value) on invoices and credit notes', async () => {
      const invoiceId = await createDraftInvoice(db, fx);
      const bad: Array<[string, number, number, number]> = [
        ['0', 100, 0, 100],
        ['1', -1, 0, 100],
        ['1', 100, -1, 100],
        ['1', 100, 0, -1],
      ];
      for (const [quantity, price, discount, taxable] of bad) {
        await expectBlocked(
          db.query(
            `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, discount_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
             VALUES ($1, 'x', '4820', $2, 'NOS', $3, $4, $5, 18, 0)`,
            [invoiceId, quantity, price, discount, taxable],
          ),
          /ili_nonneg/,
        );
      }
      const creditNoteId = await insertOne(
        db,
        `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason) VALUES ($1, $2, $3, $4, 'x') RETURNING id`,
        [fx.businessId, invoiceId, fx.financialYearId, nextNumber('CNLINE')],
      );
      await expectBlocked(
        db.query(
          `INSERT INTO credit_note_line_items (credit_note_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
           VALUES ($1, 'x', '4820', 0, 'NOS', 1, 1, 18, 1)`,
          [creditNoteId],
        ),
        /cnli_nonneg/,
      );
    });
  });

  describe('invoice lifecycle (mirrors the real server actions)', () => {
    it('allows the whole draft -> finalize -> payment -> archive -> email -> credit note flow', async () => {
      const invoiceId = await createDraftInvoice(db, fx);
      await addInvoiceLine(db, invoiceId);

      // save-invoice-draft pattern: update the draft, delete all lines, re-insert them.
      await db.query(`UPDATE invoices SET notes = 'edited while draft' WHERE id = $1`, [invoiceId]);
      await db.query(`DELETE FROM invoice_line_items WHERE invoice_id = $1`, [invoiceId]);
      await addInvoiceLine(db, invoiceId);

      await finalizeInvoice(db, invoiceId);

      // record-payment / void-payment / finalize-credit-note / void-credit-note: payment_status only.
      await db.query(`INSERT INTO payments (business_id, invoice_id, amount_paise, payment_date, payment_method) VALUES ($1, $2, 5000, '2026-10-27', 'upi')`, [fx.businessId, invoiceId]);
      await db.query(`UPDATE invoices SET payment_status = 'partially_paid' WHERE id = $1`, [invoiceId]);
      await db.query(`UPDATE payments SET status = 'voided', voided_at = now(), void_reason = 'mistake' WHERE invoice_id = $1`, [invoiceId]);
      await db.query(`UPDATE invoices SET payment_status = 'unpaid' WHERE id = $1`, [invoiceId]);

      // archive-invoice
      await db.query(`UPDATE invoices SET pdf_storage_key = 'invoices/x.pdf', archival_status = 'archived', archived_at = now() WHERE id = $1`, [invoiceId]);
      await db.query(`UPDATE invoices SET archival_status = 'failed', archival_attempts = archival_attempts + 1 WHERE id = $1`, [invoiceId]);
      // email-invoice / send-payment-reminder
      await db.query(`UPDATE invoices SET emailed_at = now(), email_send_count = email_send_count + 1 WHERE id = $1`, [invoiceId]);
      await db.query(`UPDATE invoices SET updated_at = now() WHERE id = $1`, [invoiceId]);

      // credit note flow against the finalized invoice
      const creditNoteId = await createFinalizedCreditNote(db, fx, invoiceId);
      await db.query(`UPDATE invoices SET payment_status = 'paid' WHERE id = $1`, [invoiceId]);
      await db.query(`UPDATE credit_notes SET pdf_storage_key = 'credit-notes/x.pdf', updated_at = now() WHERE id = $1`, [creditNoteId]);
      await db.query(
        `UPDATE credit_notes SET status = 'voided', voided_at = now(), void_reason = 'wrong', void_notes = 'n' WHERE id = $1`,
        [creditNoteId],
      );
    });

    it('deletes a DRAFT invoice together with its lines (cascade) without trigger errors', async () => {
      const invoiceId = await createDraftInvoice(db, fx);
      await addInvoiceLine(db, invoiceId);
      await db.query(`DELETE FROM invoices WHERE id = $1`, [invoiceId]);
      const remaining = await db.query(`SELECT 1 FROM invoice_line_items WHERE invoice_id = $1`, [invoiceId]);
      expect(remaining.rows).toHaveLength(0);
    });
  });

  describe('finalized invoice immutability', () => {
    let invoiceId: string;
    let lineId: string;

    beforeAll(async () => {
      invoiceId = await createDraftInvoice(db, fx);
      lineId = await addInvoiceLine(db, invoiceId);
      await finalizeInvoice(db, invoiceId);
    }, 60_000);

    it.each([
      ['grand_total_paise', `grand_total_paise = 1`],
      ['subtotal_paise', `subtotal_paise = 1`],
      ['total_tax_paise', `total_tax_paise = 1`],
      ['total_cgst_paise', `total_cgst_paise = 1`],
      ['invoice_number', `invoice_number = 'HACKED'`],
      ['invoice_sequence', `invoice_sequence = 999999`],
      ['invoice_date', `invoice_date = '2020-01-01'`],
      ['due_date', `due_date = '2020-01-01'`],
      ['customer_id', `customer_id = gen_random_uuid()`],
      ['seller_gstin_snapshot', `seller_gstin_snapshot = '27ZZZZZ9999Z1Z1'`],
      ['billing_name_snapshot', `billing_name_snapshot = 'Someone Else'`],
      ['place_of_supply_state_code', `place_of_supply_state_code = '99'`],
      ['gst_rate_type', `gst_rate_type = 'inclusive'`],
      ['invoice_template', `invoice_template = 'template_9'`],
      ['finalized_at', `finalized_at = '2020-01-01T00:00:00Z'`],
      ['notes', `notes = 'changed'`],
      ['business_id', `business_id = gen_random_uuid()`],
      ['financial_year_id', `financial_year_id = gen_random_uuid()`],
      ['invoice_type', `invoice_type = 'bill_of_supply'`],
      ['lifecycle_status', `lifecycle_status = 'draft'`],
    ])('blocks changing %s', async (column, assignment) => {
      await expectBlocked(db.query(`UPDATE invoices SET ${assignment} WHERE id = $1`, [invoiceId]), new RegExp(`BM_IMMUTABLE_RECORD.*${column}`));
    });

    it('names every offending column when several change at once', async () => {
      await expectBlocked(
        db.query(`UPDATE invoices SET grand_total_paise = 1, subtotal_paise = 2 WHERE id = $1`, [invoiceId]),
        /grand_total_paise, subtotal_paise/,
      );
    });

    it('blocks a mixed update that touches one allowed and one protected column', async () => {
      await expectBlocked(
        db.query(`UPDATE invoices SET payment_status = 'paid', grand_total_paise = 1 WHERE id = $1`, [invoiceId]),
        /grand_total_paise/,
      );
      const check = await db.query<{ payment_status: string }>(`SELECT payment_status::text AS payment_status FROM invoices WHERE id = $1`, [invoiceId]);
      expect(check.rows[0]?.payment_status).toBe('unpaid');
    });

    it('allows the documented post-finalization columns', async () => {
      await db.query(`UPDATE invoices SET payment_status = 'paid' WHERE id = $1`, [invoiceId]);
      await db.query(`UPDATE invoices SET pdf_storage_key = 'k', archival_status = 'archived', archival_attempts = 2, archived_at = now() WHERE id = $1`, [invoiceId]);
      await db.query(`UPDATE invoices SET emailed_at = now(), email_send_count = 3, updated_at = now() WHERE id = $1`, [invoiceId]);
    });

    it('treats a no-op update of a protected column as allowed (value unchanged)', async () => {
      await db.query(`UPDATE invoices SET grand_total_paise = grand_total_paise WHERE id = $1`, [invoiceId]);
    });

    it('blocks deleting a finalized invoice', async () => {
      await expectBlocked(db.query(`DELETE FROM invoices WHERE id = $1`, [invoiceId]), /cannot be deleted/);
    });

    it('blocks inserting, updating and deleting line items of a finalized invoice', async () => {
      await expectBlocked(addInvoiceLine(db, invoiceId), /line items of finalized invoice/);
      await expectBlocked(db.query(`UPDATE invoice_line_items SET unit_price_paise = 1 WHERE id = $1`, [lineId]), /cannot be update/);
      await expectBlocked(db.query(`DELETE FROM invoice_line_items WHERE id = $1`, [lineId]), /cannot be delete/);
      await expectBlocked(db.query(`DELETE FROM invoice_line_items WHERE invoice_id = $1`, [invoiceId]), /cannot be delete/);
    });

    it('blocks moving a line item onto a finalized invoice', async () => {
      const draftId = await createDraftInvoice(db, fx);
      const draftLine = await addInvoiceLine(db, draftId);
      await expectBlocked(db.query(`UPDATE invoice_line_items SET invoice_id = $1 WHERE id = $2`, [invoiceId, draftLine]), /line items of finalized invoice/);
    });
  });

  describe('finalized credit note immutability', () => {
    let creditNoteId: string;

    beforeAll(async () => {
      const invoiceId = await createDraftInvoice(db, fx);
      await addInvoiceLine(db, invoiceId);
      await finalizeInvoice(db, invoiceId);
      creditNoteId = await createFinalizedCreditNote(db, fx, invoiceId);
    }, 60_000);

    it.each([
      ['reason', `reason = 'changed'`],
      ['grand_total_paise', `grand_total_paise = 1`],
      ['credit_note_number', `credit_note_number = 'HACKED'`],
      ['credit_note_sequence', `credit_note_sequence = 777777`],
      ['issue_date', `issue_date = '2020-01-01'`],
      ['original_invoice_id', `original_invoice_id = gen_random_uuid()`],
      ['lifecycle_status', `lifecycle_status = 'draft'`],
    ])('blocks changing %s', async (column, assignment) => {
      await expectBlocked(db.query(`UPDATE credit_notes SET ${assignment} WHERE id = $1`, [creditNoteId]), new RegExp(`BM_IMMUTABLE_RECORD.*${column}`));
    });

    it('allows archival and void columns', async () => {
      await db.query(`UPDATE credit_notes SET pdf_storage_key = 'k', updated_at = now() WHERE id = $1`, [creditNoteId]);
      await db.query(`UPDATE credit_notes SET status = 'voided', voided_at = now(), void_reason = 'r', void_notes = 'n' WHERE id = $1`, [creditNoteId]);
    });

    it('blocks deleting a finalized credit note and editing its line items', async () => {
      await expectBlocked(db.query(`DELETE FROM credit_notes WHERE id = $1`, [creditNoteId]), /cannot be deleted/);
      await expectBlocked(db.query(`UPDATE credit_note_line_items SET unit_price_paise = 1 WHERE credit_note_id = $1`, [creditNoteId]), /line items of finalized credit note/);
      await expectBlocked(db.query(`DELETE FROM credit_note_line_items WHERE credit_note_id = $1`, [creditNoteId]), /line items of finalized credit note/);
      await expectBlocked(
        db.query(
          `INSERT INTO credit_note_line_items (credit_note_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
           VALUES ($1, 'x', '4820', 1, 'NOS', 1, 1, 18, 1)`,
          [creditNoteId],
        ),
        /line items of finalized credit note/,
      );
    });

    it('still allows a DRAFT credit note to be edited and deleted with its lines', async () => {
      const invoiceId = await createDraftInvoice(db, fx);
      const draftId = await insertOne(
        db,
        `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason) VALUES ($1, $2, $3, $4, 'draft') RETURNING id`,
        [fx.businessId, invoiceId, fx.financialYearId, nextNumber('CNDRAFT2')],
      );
      await db.query(
        `INSERT INTO credit_note_line_items (credit_note_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
         VALUES ($1, 'x', '4820', 1, 'NOS', 1, 1, 18, 1)`,
        [draftId],
      );
      await db.query(`UPDATE credit_notes SET reason = 'edited' WHERE id = $1`, [draftId]);
      await db.query(`DELETE FROM credit_note_line_items WHERE credit_note_id = $1`, [draftId]);
      await db.query(`DELETE FROM credit_notes WHERE id = $1`, [draftId]);
    });
  });

  describe('migration safety', () => {
    it('is idempotent: re-running the DB-001 migration changes nothing and does not fail', async () => {
      const countObjects = async (): Promise<{ checks: number; triggers: number }> => {
        const checks = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_constraint WHERE conname IN ('invoices_money_nonneg','invoices_final_requires_number','ili_nonneg','credit_notes_money_nonneg','credit_notes_final_requires_number','cnli_nonneg','payments_amount_positive') AND convalidated`,
        );
        const triggers = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_trigger WHERE tgname LIKE 'bm\\_%\\_guard' AND NOT tgisinternal`);
        return { checks: Number(checks.rows[0]?.n), triggers: Number(triggers.rows[0]?.n) };
      };
      const before = await countObjects();
      expect(before).toEqual({ checks: 7, triggers: 4 });
      for (const statement of statementsOf(DB001_TAG)) {
        await db.exec(statement);
      }
      expect(await countObjects()).toEqual(before);
    });

    it('fails ATOMICALLY (nothing applied) when legacy rows violate a rule', async () => {
      const legacy = new PGlite();
      try {
        await applyMigrations(legacy, PRE_DB001_TAG);
        const legacyFx = await createFixture(legacy);
        // A legacy "finalized" invoice that has no sequence/date: exactly what DB-001 must flag.
        await legacy.query(
          `INSERT INTO invoices (business_id, financial_year_id, invoice_number, lifecycle_status) VALUES ($1, $2, 'LEGACY-1', 'finalized')`,
          [legacyFx.businessId, legacyFx.financialYearId],
        );
        await expect(
          legacy.transaction(async (tx) => {
            for (const statement of statementsOf(DB001_TAG)) {
              await tx.exec(statement);
            }
          }),
        ).rejects.toThrow(/invoices_final_requires_number/);
        const leftovers = await legacy.query<{ n: string }>(
          `SELECT (SELECT count(*) FROM pg_constraint WHERE conname = 'invoices_money_nonneg') + (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'bm\\_%\\_guard') AS n`,
        );
        expect(Number(leftovers.rows[0]?.n)).toBe(0);
      } finally {
        await legacy.close();
      }
    }, 120_000);

    it('fails closed for columns added later: a new column on a finalized invoice is immutable until the trigger allow-list is updated', async () => {
      const invoiceId = await createDraftInvoice(db, fx);
      await addInvoiceLine(db, invoiceId);
      await finalizeInvoice(db, invoiceId);
      await db.exec(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS future_column text`);
      await expectBlocked(db.query(`UPDATE invoices SET future_column = 'x' WHERE id = $1`, [invoiceId]), /future_column/);
      await db.exec(`ALTER TABLE invoices DROP COLUMN IF EXISTS future_column`);
    });
  });
});
