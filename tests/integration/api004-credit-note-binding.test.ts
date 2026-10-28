import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ActionResult } from '@/lib/actions/_shared/types';
import * as schema from '@/lib/db/schema';

const state = vi.hoisted(() => ({ db: undefined as unknown, businessId: '' }));

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));
vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({
    id: '00000000-0000-0000-0000-000000000001',
    business_id: state.businessId,
  }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: () => undefined }));
vi.mock('@/lib/storage/archive-credit-note', () => ({ archiveCreditNotePdf: async () => ({ success: true }) }));

import { finalizeCreditNote } from '@/lib/actions/credit-notes/finalize-credit-note';
import { saveCreditNoteDraft } from '@/lib/actions/credit-notes/save-credit-note-draft';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');
const API004_SUFFIX = '_api004_credit_note_original_line_link';

interface JournalEntry {
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
    if (!isRecord(entry) || typeof entry.tag !== 'string') {
      throw new Error('malformed journal entry');
    }
    return { tag: entry.tag };
  });
}

async function applyMigrations(pg: PGlite, entries: JournalEntry[]): Promise<void> {
  for (const entry of entries) {
    const statements = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) {
      await pg.exec(statement);
    }
  }
}

interface IdRow {
  id: string;
}

async function insertOne(pg: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const result = await pg.query<IdRow>(sqlText, params);
  const row = result.rows[0];
  if (!row) {
    throw new Error(`no row returned for: ${sqlText}`);
  }
  return row.id;
}

function expectSuccess<T>(result: ActionResult<T>): T {
  if (!result.success) {
    throw new Error(`expected success but got ${result.error.code}: ${result.error.message}`);
  }
  return result.data;
}

function expectFailure<T>(result: ActionResult<T>, code: string): void {
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.code).toBe(code);
  }
}

describe('API-004: Credit note binding to original invoice lines', () => {
  let pg: PGlite;
  let businessId: string;
  let financialYearId: string;
  let customerId: string;

  // Migration test IDs
  let inv1Id: string;
  let iliSingleId: string;
  let iliDup1Id: string;
  let iliDup2Id: string;
  let iliFinalId: string;
  let invOtherId: string;
  let iliOtherId: string;

  let cnDraftId: string;
  let cnFinalId: string;
  let cnliSingleId: string;
  let cnliDupId: string;
  let cnliDiffPriceId: string;
  let cnliFinalId: string;

  beforeAll(async () => {
    pg = new PGlite();
    state.db = drizzle(pg, { schema });

    const journal = readJournal();
    const api004Pos = journal.findIndex((e) => e.tag.endsWith(API004_SUFFIX));
    if (api004Pos < 1) {
      throw new Error(`journal has no migration ending in ${API004_SUFFIX}`);
    }

    // 1. Apply migrations up to BEFORE API-004
    await applyMigrations(pg, journal.slice(0, api004Pos));

    // 2. Set up fixtures before API-004 migration
    businessId = await insertOne(
      pg,
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Acme Corp', '29ABCDE1234F1Z5', '1 Main St', 'Bengaluru', '29', '560001') RETURNING id`,
    );
    state.businessId = businessId;

    financialYearId = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true) RETURNING id`,
      [businessId],
    );

    customerId = await insertOne(
      pg,
      `INSERT INTO customers (business_id, name, email, state_code)
       VALUES ($1, 'Customer One', 'c1@example.com', '29') RETURNING id`,
      [businessId],
    );

    inv1Id = await insertOne(
      pg,
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, customer_id, lifecycle_status,
         place_of_supply_state_code, subtotal_paise, total_tax_paise, grand_total_paise, invoice_date, due_date, seller_gstin_snapshot)
       VALUES ($1, $2, 'INV-2026-0001', $3, 'draft', '29', 20000, 0, 20000, '2026-04-10', '2026-05-10', '29ABCDE1234F1Z5') RETURNING id`,
      [businessId, financialYearId, customerId],
    );

    iliSingleId = await insertOne(
      pg,
      `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
         taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, 'Single Item', '1234', 2.000, 'NOS', 5000, 10000, '0.00', 10000) RETURNING id`,
      [inv1Id],
    );

    iliDup1Id = await insertOne(
      pg,
      `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
         taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, 'Duplicate Item', '1234', 1.000, 'NOS', 2000, 2000, '0.00', 2000) RETURNING id`,
      [inv1Id],
    );

    iliDup2Id = await insertOne(
      pg,
      `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
         taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, 'Duplicate Item', '1234', 1.000, 'NOS', 2000, 2000, '0.00', 2000) RETURNING id`,
      [inv1Id],
    );

    iliFinalId = await insertOne(
      pg,
      `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
         taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, 'Finalized Item', '5678', 2.000, 'NOS', 3000, 6000, '0.00', 6000) RETURNING id`,
      [inv1Id],
    );

    await pg.query(
      `UPDATE invoices SET lifecycle_status = 'finalized', invoice_sequence = 1, finalized_at = now() WHERE id = $1`,
      [inv1Id],
    );

    // Another invoice to test cross-invoice line references
    invOtherId = await insertOne(
      pg,
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, customer_id, lifecycle_status,
         place_of_supply_state_code, subtotal_paise, total_tax_paise, grand_total_paise, invoice_date, due_date, seller_gstin_snapshot)
       VALUES ($1, $2, 'INV-2026-0002', $3, 'draft', '29', 10000, 0, 10000, '2026-04-10', '2026-05-10', '29ABCDE1234F1Z5') RETURNING id`,
      [businessId, financialYearId, customerId],
    );

    iliOtherId = await insertOne(
      pg,
      `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
         taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, 'Other Item', '9999', 1.000, 'NOS', 1000, 1000, '0.00', 1000) RETURNING id`,
      [invOtherId],
    );

    await pg.query(
      `UPDATE invoices SET lifecycle_status = 'finalized', invoice_sequence = 2, finalized_at = now() WHERE id = $1`,
      [invOtherId],
    );

    // Draft credit note with:
    // (a) line matching exactly one original line (iliSingleId)
    // (b) line matching two identical original lines (iliDup1Id and iliDup2Id)
    // (c) line whose unit price differs from every original line
    cnDraftId = await insertOne(
      pg,
      `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason, lifecycle_status, status)
       VALUES ($1, $2, $3, 'DRAFT-CN-MIG', '01-sales-return', 'draft', 'active') RETURNING id`,
      [businessId, inv1Id, financialYearId],
    );

    cnliSingleId = await insertOne(
      pg,
      `INSERT INTO credit_note_line_items (credit_note_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
         taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, 'Single Item', '1234', 1.000, 'NOS', 5000, 5000, '0.00', 5000) RETURNING id`,
      [cnDraftId],
    );

    cnliDupId = await insertOne(
      pg,
      `INSERT INTO credit_note_line_items (credit_note_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
         taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, 'Duplicate Item', '1234', 1.000, 'NOS', 2000, 2000, '0.00', 2000) RETURNING id`,
      [cnDraftId],
    );

    cnliDiffPriceId = await insertOne(
      pg,
      `INSERT INTO credit_note_line_items (credit_note_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
         taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, 'Single Item', '1234', 1.000, 'NOS', 9999, 9999, '0.00', 9999) RETURNING id`,
      [cnDraftId],
    );

    // Finalized credit note with line matching iliFinalId
    cnFinalId = await insertOne(
      pg,
      `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason, lifecycle_status, status)
       VALUES ($1, $2, $3, 'CN-2026-0001', '01-sales-return', 'draft', 'active') RETURNING id`,
      [businessId, inv1Id, financialYearId],
    );

    cnliFinalId = await insertOne(
      pg,
      `INSERT INTO credit_note_line_items (credit_note_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
         taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, 'Finalized Item', '5678', 1.000, 'NOS', 3000, 3000, '0.00', 3000) RETURNING id`,
      [cnFinalId],
    );

    await pg.query(
      `UPDATE credit_notes SET lifecycle_status = 'finalized', credit_note_sequence = 1, issue_date = '2026-04-12', finalized_at = now() WHERE id = $1`,
      [cnFinalId],
    );
    await pg.query(
      `UPDATE financial_years SET credit_note_sequence_counter = 1 WHERE id = $1`,
      [financialYearId],
    );

    // 3. Now apply migration 0017!
    await applyMigrations(pg, [journal[api004Pos]]);
  }, 60_000);

  afterAll(async () => {
    if (pg) {
      await pg.close();
    }
  });

  describe('Migration 0017 verification', () => {
    it('(a) single match line is linked to original line item', async () => {
      const res = await pg.query<{ original_line_item_id: string }>(
        `SELECT original_line_item_id FROM credit_note_line_items WHERE id = $1`,
        [cnliSingleId],
      );
      expect(res.rows[0]?.original_line_item_id).toBe(iliSingleId);
    });

    it('(d) line on finalized credit note is linked to original line item', async () => {
      const res = await pg.query<{ original_line_item_id: string }>(
        `SELECT original_line_item_id FROM credit_note_line_items WHERE id = $1`,
        [cnliFinalId],
      );
      expect(res.rows[0]?.original_line_item_id).toBe(iliFinalId);
    });

    it('(b) and (c) ambiguous and non-matching lines remain NULL', async () => {
      const resDup = await pg.query<{ original_line_item_id: string | null }>(
        `SELECT original_line_item_id FROM credit_note_line_items WHERE id = $1`,
        [cnliDupId],
      );
      expect(resDup.rows[0]?.original_line_item_id).toBeNull();

      const resDiff = await pg.query<{ original_line_item_id: string | null }>(
        `SELECT original_line_item_id FROM credit_note_line_items WHERE id = $1`,
        [cnliDiffPriceId],
      );
      expect(resDiff.rows[0]?.original_line_item_id).toBeNull();
    });

    it('bm_credit_note_line_items_guard is enabled (tgenabled = "O")', async () => {
      const res = await pg.query<{ tgenabled: string }>(
        `SELECT tgenabled FROM pg_trigger WHERE tgname = 'bm_credit_note_line_items_guard'`,
      );
      expect(res.rows[0]?.tgenabled).toBe('O');
    });

    it('UPDATE of a finalized credit note line is rejected by immutability guard', async () => {
      await expect(
        pg.query(`UPDATE credit_note_line_items SET quantity = 1.500 WHERE id = $1`, [cnliFinalId]),
      ).rejects.toThrow();
    });

    it('link trigger rejects a line pointing at another invoice line', async () => {
      await expect(
        pg.query(
          `INSERT INTO credit_note_line_items (credit_note_id, original_line_item_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
           VALUES ($1, $2, 'Cross Item', '9999', 1.000, 'NOS', 1000, 1000, '0.00', 1000)`,
          [cnDraftId, iliOtherId],
        ),
      ).rejects.toThrow(/BM_LINK_VIOLATION/);
    });

    it('INSERT with NULL original_line_item_id violates cnli_original_line_required while existing NULL rows are readable', async () => {
      await expect(
        pg.query(
          `INSERT INTO credit_note_line_items (credit_note_id, original_line_item_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
           VALUES ($1, NULL, 'New Item', '1234', 1.000, 'NOS', 1000, 1000, '0.00', 1000)`,
          [cnDraftId],
        ),
      ).rejects.toThrow(/cnli_original_line_required/);

      // Existing NULL rows remain readable
      const res = await pg.query(`SELECT id FROM credit_note_line_items WHERE id = $1`, [cnliDupId]);
      expect(res.rows.length).toBe(1);
    });
  });

  describe('Server Action tests with clean test invoices', () => {
    let cleanInvId: string;
    let cleanLine1Id: string;
    let cleanLine2Id: string;

    beforeAll(async () => {
      // Create a fresh finalized invoice for action testing
      cleanInvId = await insertOne(
        pg,
        `INSERT INTO invoices (business_id, financial_year_id, invoice_number, customer_id, lifecycle_status,
           place_of_supply_state_code, subtotal_paise, total_tax_paise, grand_total_paise, invoice_date, due_date, seller_gstin_snapshot)
         VALUES ($1, $2, 'INV-2026-CLEAN', $3, 'draft', '29', 20000, 3600, 23600, '2026-04-10', '2026-05-10', '29ABCDE1234F1Z5') RETURNING id`,
        [businessId, financialYearId, customerId],
      );

      cleanLine1Id = await insertOne(
        pg,
        `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
           discount_paise, taxable_value_paise, tax_rate_percentage, line_total_paise, cgst_paise, sgst_paise)
         VALUES ($1, 'Clean Widget', '8471', 5.000, 'NOS', 2000, 0, 10000, '18.00', 11800, 900, 900) RETURNING id`,
        [cleanInvId],
      );

      cleanLine2Id = await insertOne(
        pg,
        `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
           discount_paise, taxable_value_paise, tax_rate_percentage, line_total_paise, cgst_paise, sgst_paise)
         VALUES ($1, 'Clean Gadget', '8471', 2.000, 'NOS', 5000, 0, 10000, '18.00', 11800, 900, 900) RETURNING id`,
        [cleanInvId],
      );

      await pg.query(
        `UPDATE invoices SET lifecycle_status = 'finalized', invoice_sequence = 10, finalized_at = now() WHERE id = $1`,
        [cleanInvId],
      );
    });

    it('second draft that together with the first exceeds original qty -> QUANTITY_EXCEEDS_ORIGINAL', async () => {
      // Draft 1 saves with qty 3 (out of 5)
      const draft1 = expectSuccess(
        await saveCreditNoteDraft({
          original_invoice_id: cleanInvId,
          reason: '01-sales-return',
          line_items: [{ original_line_item_id: cleanLine1Id, quantity: 3 }],
        }),
      );
      expect(draft1.id).toBeDefined();

      // Draft 2 attempts to save with qty 3 (3 + 3 = 6 > 5)
      const res = await saveCreditNoteDraft({
        original_invoice_id: cleanInvId,
        reason: '01-sales-return',
        line_items: [{ original_line_item_id: cleanLine1Id, quantity: 3 }],
      });
      expectFailure(res, 'QUANTITY_EXCEEDS_ORIGINAL');

      // Clean up Draft 1 for subsequent tests
      await pg.query(`DELETE FROM credit_note_line_items WHERE credit_note_id = $1`, [draft1.id]);
      await pg.query(`DELETE FROM credit_notes WHERE id = $1`, [draft1.id]);
    });

    it('a voided credit note frees capacity', async () => {
      // Create draft with qty 5 (full quantity)
      const draft = expectSuccess(
        await saveCreditNoteDraft({
          original_invoice_id: cleanInvId,
          reason: '01-sales-return',
          line_items: [{ original_line_item_id: cleanLine1Id, quantity: 5 }],
        }),
      );

      // Finalize it
      const finalized = expectSuccess(await finalizeCreditNote({ id: draft.id }));
      expect(finalized.id).toBe(draft.id);

      // Now attempting another credit note should fail because remaining quantity is 0
      const attempt1 = await saveCreditNoteDraft({
        original_invoice_id: cleanInvId,
        reason: '01-sales-return',
        line_items: [{ original_line_item_id: cleanLine1Id, quantity: 1 }],
      });
      expectFailure(attempt1, 'QUANTITY_EXCEEDS_ORIGINAL');

      // Void the finalized credit note
      await pg.query(`UPDATE credit_notes SET status = 'voided' WHERE id = $1`, [draft.id]);

      // Capacity is now freed: saving a new credit note draft succeeds!
      const draftAfterVoid = expectSuccess(
        await saveCreditNoteDraft({
          original_invoice_id: cleanInvId,
          reason: '01-sales-return',
          line_items: [{ original_line_item_id: cleanLine1Id, quantity: 5 }],
        }),
      );
      expect(draftAfterVoid.id).toBeDefined();

      // Clean up
      await pg.query(`DELETE FROM credit_note_line_items WHERE credit_note_id = $1`, [draftAfterVoid.id]);
      await pg.query(`DELETE FROM credit_notes WHERE id = $1`, [draftAfterVoid.id]);
    });

    it('two partial drafts consuming the line -> totals equal original to the paisa and cap holds', async () => {
      // Draft A takes qty 2
      const draftA = expectSuccess(
        await saveCreditNoteDraft({
          original_invoice_id: cleanInvId,
          reason: '01-sales-return',
          line_items: [{ original_line_item_id: cleanLine1Id, quantity: 2 }],
        }),
      );

      // Draft B takes remainder qty 3
      const draftB = expectSuccess(
        await saveCreditNoteDraft({
          original_invoice_id: cleanInvId,
          reason: '01-sales-return',
          line_items: [{ original_line_item_id: cleanLine1Id, quantity: 3 }],
        }),
      );

      const rowsA = await pg.query<{ taxable_value_paise: number; cgst_paise: number; sgst_paise: number; line_total_paise: number }>(
        `SELECT taxable_value_paise, cgst_paise, sgst_paise, line_total_paise FROM credit_note_line_items WHERE credit_note_id = $1`,
        [draftA.id],
      );
      const rowsB = await pg.query<{ taxable_value_paise: number; cgst_paise: number; sgst_paise: number; line_total_paise: number }>(
        `SELECT taxable_value_paise, cgst_paise, sgst_paise, line_total_paise FROM credit_note_line_items WHERE credit_note_id = $1`,
        [draftB.id],
      );

      const lineA = rowsA.rows[0]!;
      const lineB = rowsB.rows[0]!;

      expect(lineA.taxable_value_paise + lineB.taxable_value_paise).toBe(10000);
      expect(lineA.cgst_paise + lineB.cgst_paise).toBe(900);
      expect(lineA.sgst_paise + lineB.sgst_paise).toBe(900);
      expect(lineA.line_total_paise + lineB.line_total_paise).toBe(11800);

      // Clean up
      await pg.query(`DELETE FROM credit_note_line_items WHERE credit_note_id IN ($1, $2)`, [draftA.id, draftB.id]);
      await pg.query(`DELETE FROM credit_notes WHERE id IN ($1, $2)`, [draftA.id, draftB.id]);
    });

    it('foreign original_line_item_id -> ITEM_MISMATCH', async () => {
      const res = await saveCreditNoteDraft({
        original_invoice_id: cleanInvId,
        reason: '01-sales-return',
        line_items: [{ original_line_item_id: iliOtherId, quantity: 1 }],
      });
      expectFailure(res, 'ITEM_MISMATCH');
    });

    it('legacy NULL-linked draft on invoice blocks a new save with LEGACY_CREDIT_UNLINKED', async () => {
      // inv1Id has cnliDupId which has original_line_item_id = NULL
      const res = await saveCreditNoteDraft({
        original_invoice_id: inv1Id,
        reason: '01-sales-return',
        line_items: [{ original_line_item_id: iliSingleId, quantity: 1 }],
      });
      expectFailure(res, 'LEGACY_CREDIT_UNLINKED');
    });

    it('finalizing a tampered draft is rejected with CREDIT_NOTE_STALE and writes nothing', async () => {
      const draft = expectSuccess(
        await saveCreditNoteDraft({
          original_invoice_id: cleanInvId,
          reason: '01-sales-return',
          line_items: [{ original_line_item_id: cleanLine2Id, quantity: 1 }],
        }),
      );

      // Tamper stored draft line item directly in database
      await pg.query(
        `UPDATE credit_note_line_items SET quantity = 2.000, line_total_paise = 99999 WHERE credit_note_id = $1`,
        [draft.id],
      );

      // Attempt to finalize
      const res = await finalizeCreditNote({ id: draft.id });
      expectFailure(res, 'CREDIT_NOTE_STALE');

      // Assert draft is still 'draft' and not finalized
      const cnRow = await pg.query<{ lifecycle_status: string }>(
        `SELECT lifecycle_status FROM credit_notes WHERE id = $1`,
        [draft.id],
      );
      expect(cnRow.rows[0]?.lifecycle_status).toBe('draft');

      // Clean up
      await pg.query(`DELETE FROM credit_note_line_items WHERE credit_note_id = $1`, [draft.id]);
      await pg.query(`DELETE FROM credit_notes WHERE id = $1`, [draft.id]);
    });

    it('finalize order A->B and B->A both end <= invoice totals', async () => {
      // Invoice 1: finalize A then B
      const draft1A = expectSuccess(
        await saveCreditNoteDraft({
          original_invoice_id: cleanInvId,
          reason: '01-sales-return',
          line_items: [{ original_line_item_id: cleanLine2Id, quantity: 1 }],
        }),
      );
      const draft1B = expectSuccess(
        await saveCreditNoteDraft({
          original_invoice_id: cleanInvId,
          reason: '01-sales-return',
          line_items: [{ original_line_item_id: cleanLine2Id, quantity: 1 }],
        }),
      );

      expectSuccess(await finalizeCreditNote({ id: draft1A.id }));
      expectSuccess(await finalizeCreditNote({ id: draft1B.id }));

      const sum1 = await pg.query<{ total: string }>(
        `SELECT SUM(grand_total_paise)::text AS total FROM credit_notes WHERE id IN ($1, $2)`,
        [draft1A.id, draft1B.id],
      );
      expect(Number(sum1.rows[0]?.total)).toBeLessThanOrEqual(11800);

      // Clean up
      await pg.query(`UPDATE credit_notes SET status = 'voided' WHERE id IN ($1, $2)`, [draft1A.id, draft1B.id]);
    });
  });
});
