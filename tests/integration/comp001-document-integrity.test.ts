import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  businessId: '',
  deletedKeys: [] as string[],
}));

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
vi.mock('@/lib/storage/archive-invoice', () => ({ archiveInvoicePdf: async () => ({ success: true }) }));
vi.mock('@/lib/storage/archive-credit-note', () => ({ archiveCreditNotePdf: async () => ({ success: true }) }));

vi.mock('@/lib/storage/idrive', () => ({
  getFileBuffer: async (key: string) => {
    if (key.includes('missing') || key.includes('unknown') || key.includes('random')) {
      throw new Error('S3 NoSuchKey');
    }
    return Buffer.from('fake-image-bytes');
  },
  deleteFileFromStorage: async (key: string) => {
    state.deletedKeys.push(key);
  },
}));

import { finalizeInvoice } from '@/lib/actions/invoices/finalize-invoice';
import { saveInvoiceDraft } from '@/lib/actions/invoices/save-invoice-draft';
import { finalizeCreditNote } from '@/lib/actions/credit-notes/finalize-credit-note';
import { saveCreditNoteDraft } from '@/lib/actions/credit-notes/save-credit-note-draft';
import { getCreditNote } from '@/lib/actions/credit-notes/get-credit-note';
import { resolveSellerDetails, toInvoicePrintFields, type SellerSnapshotRow } from '@/lib/invoices/seller-snapshot';
import { isLogoKeyReferenced, deleteLogoObjectIfUnreferenced } from '@/lib/storage/logo';
import type { DbExecutor } from '@/lib/actions/_shared/ownership';
import type { ActionResult } from '@/lib/actions/_shared/types';
import { GET as logoRouteHandler } from '@/app/api/business/[id]/logo/route';
import { NextRequest } from 'next/server';

function expectSuccess<T>(result: ActionResult<T>): T {
  if (!result.success) {
    throw new Error(`Expected success but got error: ${result.error.message} (${result.error.code})`);
  }
  return result.data;
}

function expectFailure<T>(result: ActionResult<T>): {
  message: string;
  code: string;
  fieldErrors?: Record<string, string[] | undefined>;
} {
  if (result.success) {
    throw new Error('Expected failure but got success');
  }
  return result.error;
}

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');
const COMP001_SUFFIX = '_comp001_document_seller_snapshots';

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
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applyMigrations(pg: PGlite, entries: JournalEntry[]): Promise<void> {
  for (const entry of entries) {
    for (const stmt of statementsOf(entry.tag)) {
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
  if (!row) {
    throw new Error(`no row returned for: ${sqlText}`);
  }
  return row.id;
}

describe('COMP-001: Document Immutability and Seller Snapshots', () => {
  let pg: PGlite;
  let journal: JournalEntry[];
  let comp001Pos: number;

  beforeAll(async () => {
    journal = readJournal();
    comp001Pos = journal.findIndex((e) => e.tag.endsWith(COMP001_SUFFIX));
    if (comp001Pos < 1) {
      throw new Error(`journal has no migration ending in ${COMP001_SUFFIX}`);
    }
  });

  afterAll(async () => {
    if (pg) {
      await pg.close();
    }
  });

  it('1. Migration backfill: applies cleanly, populates backfilled_from_profile, and leaves guards enabled', async () => {
    const testPg = new PGlite();
    try {
      // Apply migrations up to BEFORE COMP-001
      await applyMigrations(testPg, journal.slice(0, comp001Pos));

      // Insert business profile
      const bizId = await insertOne(
        testPg,
        `INSERT INTO businesses (legal_name, trade_name, gstin, pan, address_line1, address_line2, city, state_code, pincode, phone, email, nature_of_business, logo_storage_key, bank_account_name, bank_account_number, bank_ifsc, bank_name, invoice_terms)
         VALUES ('Legacy Enterprise Ltd', 'Legacy Brand', '29ABCDE1234F1Z5', 'ABCDE1234F', 'Old Building', 'Fl 2', 'Bengaluru', '29', '560001', '+919999999999', 'legacy@example.com', 'Services', 'logos/legacy.png', 'Legacy Acct', '9988776655', 'HDFC0009999', 'HDFC Bank', 'Due in 30 days') RETURNING id`,
      );

      const fyId = await insertOne(
        testPg,
        `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current)
         VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true) RETURNING id`,
        [bizId],
      );

      const custId = await insertOne(
        testPg,
        `INSERT INTO customers (business_id, name, state_code) VALUES ($1, 'Legacy Buyer', '29') RETURNING id`,
        [bizId],
      );

      // Insert finalized invoice before 0018
      const invId = await insertOne(
        testPg,
        `INSERT INTO invoices (business_id, financial_year_id, customer_id, invoice_number, invoice_sequence, lifecycle_status, invoice_date, due_date, finalized_at, seller_gstin_snapshot, subtotal_paise, total_tax_paise, grand_total_paise)
         VALUES ($1, $2, $3, 'INV-LEGACY-01', 1, 'finalized', '2026-04-10', '2026-05-10', '2026-04-10 00:00:00+00', '29ABCDE1234F1Z5', 10000, 1800, 11800) RETURNING id`,
        [bizId, fyId, custId],
      );

      // Insert finalized credit note before 0018
      const cnId = await insertOne(
        testPg,
        `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, credit_note_sequence, reason, lifecycle_status, issue_date, finalized_at, subtotal_paise, total_tax_paise, grand_total_paise)
         VALUES ($1, $2, $3, 'CN-LEGACY-01', 1, '01-sales-return', 'finalized', '2026-04-15', '2026-04-15 00:00:00+00', 5000, 900, 5900) RETURNING id`,
        [bizId, invId, fyId],
      );

      // NOW APPLY MIGRATION 0018!
      await applyMigrations(testPg, [journal[comp001Pos]]);

      // Verify invoice was backfilled
      const invRes = await testPg.query<{
        seller_name_snapshot: string;
        seller_snapshot_source: string;
        seller_state_code_snapshot: string;
        logo_storage_key_snapshot: string;
      }>(`SELECT seller_name_snapshot, seller_snapshot_source, seller_state_code_snapshot, logo_storage_key_snapshot FROM invoices WHERE id = $1`, [invId]);
      expect(invRes.rows[0]?.seller_name_snapshot).toBe('Legacy Enterprise Ltd');
      expect(invRes.rows[0]?.seller_snapshot_source).toBe('backfilled_from_profile');
      expect(invRes.rows[0]?.seller_state_code_snapshot).toBe('29');
      expect(invRes.rows[0]?.logo_storage_key_snapshot).toBe('logos/legacy.png');

      // Verify credit note was backfilled
      const cnRes = await testPg.query<{
        seller_name_snapshot: string;
        seller_gstin_snapshot: string;
        seller_snapshot_source: string;
      }>(`SELECT seller_name_snapshot, seller_gstin_snapshot, seller_snapshot_source FROM credit_notes WHERE id = $1`, [cnId]);
      expect(cnRes.rows[0]?.seller_name_snapshot).toBe('Legacy Enterprise Ltd');
      expect(cnRes.rows[0]?.seller_gstin_snapshot).toBe('29ABCDE1234F1Z5');
      expect(cnRes.rows[0]?.seller_snapshot_source).toBe('backfilled_from_profile');

      // Verify triggers are re-enabled (tgenabled = 'O')
      const trigRes = await testPg.query<{ tgname: string; tgenabled: string }>(
        `SELECT tgname, tgenabled FROM pg_trigger WHERE tgname IN ('bm_invoices_guard', 'bm_credit_notes_guard')`,
      );
      expect(trigRes.rows).toHaveLength(2);
      for (const row of trigRes.rows) {
        expect(row.tgenabled).toBe('O');
      }

      // Verify immutability: attempting to update a snapshot column on finalized row is blocked
      await expect(
        testPg.query(`UPDATE invoices SET seller_name_snapshot = 'Tampered' WHERE id = $1`, [invId]),
      ).rejects.toThrow(/BM_IMMUTABLE_RECORD/);
    } finally {
      await testPg.close();
    }
  }, 60_000);

  describe('Server Actions & Presentation Flow with all migrations applied', () => {
    let businessId: string;
    let financialYearId: string;
    let customerId: string;
    let taxRateId: string;
    let productId: string;

    beforeAll(async () => {
      pg = new PGlite();
      state.db = drizzle(pg, { schema });
      await applyMigrations(pg, journal);

      businessId = await insertOne(
        pg,
        `INSERT INTO businesses (legal_name, trade_name, gstin, pan, address_line1, address_line2, city, state_code, pincode, phone, email, nature_of_business, logo_storage_key, bank_account_name, bank_account_number, bank_ifsc, bank_name, invoice_terms)
         VALUES ('Alpha Corp India Pvt Ltd', 'Alpha Corp', '29ABCDE1234F1Z5', 'ABCDE1234F', '123 Tech Park', 'Tower 1', 'Bengaluru', '29', '560001', '+919876543210', 'billing@alphacorp.com', 'Technology Services', 'logos/alpha-logo.png', 'Alpha Operating Account', '1234567890', 'ICIC0001234', 'ICICI Bank', 'Net 30 days') RETURNING id`,
      );
      state.businessId = businessId;

      await pg.query(
        `INSERT INTO users (id, auth_user_id, business_id, email, display_name, role)
         VALUES ('00000000-0000-0000-0000-000000000001', 'auth_001', $1, 'user@test.dev', 'Test User', 'owner')`,
        [businessId],
      );

      financialYearId = await insertOne(
        pg,
        `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current)
         VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true) RETURNING id`,
        [businessId],
      );

      customerId = await insertOne(
        pg,
        `INSERT INTO customers (business_id, name, email, state_code)
         VALUES ($1, 'Client Beta', 'beta@example.com', '29') RETURNING id`,
        [businessId],
      );

      taxRateId = await insertOne(
        pg,
        `INSERT INTO tax_rates (label, rate_percentage, effective_from)
         VALUES ('18%', 18, '2017-07-01') RETURNING id`,
      );

      productId = await insertOne(
        pg,
        `INSERT INTO products (business_id, name, hsn_sac_code, default_sale_price_paise)
         VALUES ($1, 'Cloud Hosting', '998315', 10000) RETURNING id`,
        [businessId],
      );
    }, 60_000);

    it('2. CHECK constraints reject finalized documents without required snapshots', async () => {
      // Finalized invoice without snapshot columns
      await expect(
        pg.query(
          `INSERT INTO invoices (business_id, financial_year_id, customer_id, invoice_number, invoice_sequence, lifecycle_status, invoice_date, finalized_at)
           VALUES ($1, $2, $3, 'INV-FAIL-01', 99, 'finalized', '2026-05-01', now())`,
          [businessId, financialYearId, customerId],
        ),
      ).rejects.toThrow(/invoices_final_requires_seller_snapshot/);

      // Finalized credit note without seller_gstin_snapshot
      const draftInv = await saveInvoiceDraft({
        customer_id: customerId,
        billing_name: 'Client Beta',
        place_of_supply_state_code: '29',
        invoice_date: '2026-05-01',
        gst_rate_type: 'exclusive',
        line_items: [
          {
            product_id: productId,
            description: 'Cloud Hosting',
            hsn_sac_code: '998315',
            quantity: 1,
            unit_of_measurement: 'NOS',
            unit_price: 100,
            discount: 0,
            tax_rate_id: taxRateId,
          },
        ],
      });
      const draftInvData = expectSuccess(draftInv);
      const finRes = await finalizeInvoice({ id: draftInvData.invoiceId });
      const finData = expectSuccess(finRes);

      await expect(
        pg.query(
          `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, credit_note_sequence, reason, lifecycle_status, issue_date, finalized_at, seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_snapshot_source)
           VALUES ($1, $2, $3, 'CN-FAIL-01', 99, '01-sales-return', 'finalized', '2026-05-01', now(), 'Seller', '{"city":"BLR"}'::jsonb, '29', 'captured_at_finalization')`,
          [businessId, finData.invoiceId, financialYearId],
        ),
      ).rejects.toThrow(/credit_notes_final_requires_seller_snapshot/);
    });

    it('3. finalizeInvoice captures complete seller snapshot, real finalized_at, and retains legal date', async () => {
      const beforeFinalize = Date.now();
      const draftRes = await saveInvoiceDraft({
        customer_id: customerId,
        billing_name: 'Client Beta',
        place_of_supply_state_code: '29',
        invoice_date: '2026-05-10',
        gst_rate_type: 'exclusive',
        line_items: [
          {
            product_id: productId,
            description: 'Cloud Hosting',
            hsn_sac_code: '998315',
            quantity: 2,
            unit_of_measurement: 'NOS',
            unit_price: 100,
            discount: 0,
            tax_rate_id: taxRateId,
          },
        ],
      });
      const draftData = expectSuccess(draftRes);
      const invoiceId = draftData.invoiceId;

      const finRes = await finalizeInvoice({ id: invoiceId });
      expectSuccess(finRes);
      const afterFinalize = Date.now();

      const [invRow] = (
        await pg.query<{
          seller_name_snapshot: string;
          seller_trade_name_snapshot: string;
          seller_address_snapshot: { city: string };
          seller_bank_snapshot: { bankName: string };
          seller_state_code_snapshot: string;
          seller_snapshot_source: string;
          logo_storage_key_snapshot: string;
          invoice_date: string;
          finalized_at: Date;
        }>(
          `SELECT seller_name_snapshot, seller_trade_name_snapshot, seller_address_snapshot, seller_bank_snapshot, seller_state_code_snapshot, seller_snapshot_source, logo_storage_key_snapshot, to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date, finalized_at FROM invoices WHERE id = $1`,
          [invoiceId],
        )
      ).rows;

      expect(invRow.seller_name_snapshot).toBe('Alpha Corp India Pvt Ltd');
      expect(invRow.seller_trade_name_snapshot).toBe('Alpha Corp');
      expect(invRow.seller_state_code_snapshot).toBe('29');
      expect(invRow.seller_address_snapshot.city).toBe('Bengaluru');
      expect(invRow.seller_bank_snapshot.bankName).toBe('ICICI Bank');
      expect(invRow.seller_snapshot_source).toBe('captured_at_finalization');
      expect(invRow.logo_storage_key_snapshot).toBe('logos/alpha-logo.png');
      expect(invRow.invoice_date).toBe('2026-05-10');

      // finalized_at must be recent real timestamp (not UTC midnight of 2026-05-10)
      const finalizedMillis = new Date(invRow.finalized_at).getTime();
      expect(finalizedMillis).toBeGreaterThanOrEqual(beforeFinalize - 5000);
      expect(finalizedMillis).toBeLessThanOrEqual(afterFinalize + 5000);
    });

    it('4. Presentation immutability: changing live business does not alter finalized presentation', async () => {
      // Create and finalize an invoice
      const draftRes = await saveInvoiceDraft({
        customer_id: customerId,
        billing_name: 'Client Beta',
        place_of_supply_state_code: '29',
        invoice_date: '2026-05-12',
        gst_rate_type: 'exclusive',
        line_items: [
          {
            product_id: productId,
            description: 'Cloud Hosting',
            hsn_sac_code: '998315',
            quantity: 1,
            unit_of_measurement: 'NOS',
            unit_price: 100,
            discount: 0,
            tax_rate_id: taxRateId,
          },
        ],
      });
      const invoiceId = expectSuccess(draftRes).invoiceId;
      expectSuccess(await finalizeInvoice({ id: invoiceId }));

      // Create and finalize a credit note for that invoice
      const [invLine] = (
        await pg.query<{ id: string }>(`SELECT id FROM invoice_line_items WHERE invoice_id = $1`, [invoiceId])
      ).rows;
      if (!invLine) {
        throw new Error('Line item not found');
      }
      const cnDraftRes = await saveCreditNoteDraft({
        original_invoice_id: invoiceId,
        reason: '01-sales-return',
        line_items: [{ original_line_item_id: invLine.id, quantity: 1 }],
      });
      const cnId = expectSuccess(cnDraftRes).id;
      expectSuccess(await finalizeCreditNote({ id: cnId }));

      // Mutate live business in DB to simulate subsequent profile edits
      await pg.query(
        `UPDATE businesses SET legal_name = 'Completely New Name Ltd', trade_name = 'NewBrand', city = 'Mumbai', state_code = '27', logo_storage_key = 'logos/new-brand.png' WHERE id = $1`,
        [businessId],
      );

      // Verify invoice presentation still reads frozen snapshot
      const [invRow] = (await pg.query<SellerSnapshotRow>(`SELECT * FROM invoices WHERE id = $1`, [invoiceId])).rows;
      if (!invRow) {
        throw new Error('Invoice row not found');
      }
      const seller = resolveSellerDetails(invRow, null);
      expect(seller.legalName).toBe('Alpha Corp India Pvt Ltd');
      expect(seller.city).toBe('Bengaluru');
      expect(seller.stateCode).toBe('29');
      expect(seller.logoStorageKey).toBe('logos/alpha-logo.png');

      const printFields = toInvoicePrintFields(seller);
      expect(printFields.business_name).toBe('Alpha Corp India Pvt Ltd');
      expect(printFields.city).toBe('Bengaluru');
      expect(printFields.logo_storage_key).toBe('logos/alpha-logo.png');

      // Verify credit note read still returns original details
      const cnRead = await getCreditNote({ id: cnId });
      const cnData = expectSuccess(cnRead);
      expect(cnData.business.legal_name).toBe('Alpha Corp India Pvt Ltd');
      expect(cnData.business.city).toBe('Bengaluru');
      expect(cnData.business.gstin).toBe('29ABCDE1234F1Z5');
      expect(cnData.business.logo_storage_key).toBe('logos/alpha-logo.png');

      // Revert business for remaining tests
      await pg.query(
        `UPDATE businesses SET legal_name = 'Alpha Corp India Pvt Ltd', trade_name = 'Alpha Corp', city = 'Bengaluru', state_code = '29', logo_storage_key = 'logos/alpha-logo.png' WHERE id = $1`,
        [businessId],
      );
    }, 60_000);

    it('5. Date policy in action: future date rejected, 31-day window rejected, cross-FY confirmed', async () => {
      // Form/validation rejects tomorrow
      const tomorrow = new Date(Date.now() + 86_400_000 * 2).toISOString().slice(0, 10);
      const futureDraft = await saveInvoiceDraft({
        customer_id: customerId,
        billing_name: 'Client Beta',
        place_of_supply_state_code: '29',
        invoice_date: tomorrow,
        gst_rate_type: 'exclusive',
        line_items: [
          {
            product_id: productId,
            description: 'Item',
            hsn_sac_code: '998315',
            quantity: 1,
            unit_of_measurement: 'NOS',
            unit_price: 100,
            discount: 0,
            tax_rate_id: taxRateId,
          },
        ],
      });
      const futureDraftErr = expectFailure(futureDraft);
      expect(futureDraftErr.fieldErrors?.invoice_date?.[0]).toContain('future');

      // Plant a draft invoice with a future date directly in DB to test Server Action guard
      const futureInvId = await insertOne(
        pg,
        `INSERT INTO invoices (business_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, total_tax_paise, grand_total_paise)
         VALUES ($1, $2, 'DRAFT-FUT', 'draft', $3, '29', 10000, 900, 900, 0, 1800, 11800) RETURNING id`,
        [businessId, financialYearId, tomorrow],
      );
      await pg.query(
        `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise)
         VALUES ($1, 'Item', '998315', 1.000, 'NOS', 10000, 10000, 18.00, 900, 900, 0, 11800)`,
        [futureInvId],
      );
      const futFinalRes = await finalizeInvoice({ id: futureInvId });
      const futErr = expectFailure(futFinalRes);
      expect(futErr.code).toBe('INVOICE_DATE_FUTURE');

      // With a later finalized invoice on 2026-05-12, a date 31 days earlier (2026-04-10) is rejected
      const oldInvId = await insertOne(
        pg,
        `INSERT INTO invoices (business_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, total_tax_paise, grand_total_paise)
         VALUES ($1, $2, 'DRAFT-OLD', 'draft', '2026-04-10', '29', 10000, 900, 900, 0, 1800, 11800) RETURNING id`,
        [businessId, financialYearId],
      );
      await pg.query(
        `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise)
         VALUES ($1, 'Item', '998315', 1.000, 'NOS', 10000, 10000, 18.00, 900, 900, 0, 11800)`,
        [oldInvId],
      );
      const oldFinalRes = await finalizeInvoice({ id: oldInvId });
      const oldErr = expectFailure(oldFinalRes);
      expect(oldErr.code).toBe('INVOICE_DATE_TOO_OLD');

      // Cross-FY draft without confirmation -> INVOICE_DATE_CROSS_FY
      const crossFyInvId = await insertOne(
        pg,
        `INSERT INTO invoices (business_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, total_tax_paise, grand_total_paise)
         VALUES ($1, $2, 'DRAFT-CROSS', 'draft', '2026-03-20', '29', 10000, 900, 900, 0, 1800, 11800) RETURNING id`,
        [businessId, financialYearId],
      );
      await pg.query(
        `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise)
         VALUES ($1, 'Item', '998315', 1.000, 'NOS', 10000, 10000, 18.00, 900, 900, 0, 11800)`,
        [crossFyInvId],
      );
      const crossRes1 = await finalizeInvoice({ id: crossFyInvId });
      const crossErr1 = expectFailure(crossRes1);
      expect(crossErr1.code).toBe('INVOICE_DATE_CROSS_FY');

      // Cross-FY draft with confirmation -> succeeds
      const crossRes2 = await finalizeInvoice({ id: crossFyInvId, confirm_cross_financial_year: true });
      expectSuccess(crossRes2);
    });

    it('6. Logo retention and logo route validation', async () => {
      state.deletedKeys = [];
      const referencedKey = 'logos/alpha-logo.png';
      const unreferencedKey = 'logos/orphan-temp-123.png';
      const executor = state.db as unknown as DbExecutor;

      // 1. isLogoKeyReferenced is true for referenced snapshot key
      const isRef = await isLogoKeyReferenced(executor, businessId, referencedKey);
      expect(isRef).toBe(true);

      const isUnref = await isLogoKeyReferenced(executor, businessId, unreferencedKey);
      expect(isUnref).toBe(false);

      // 2. deleteLogoObjectIfUnreferenced keeps referenced logo and does NOT delete from storage
      const resKeep = await deleteLogoObjectIfUnreferenced(businessId, referencedKey);
      expect(resKeep).toBe('kept_referenced');
      expect(state.deletedKeys).not.toContain(referencedKey);

      // 3. deleteLogoObjectIfUnreferenced deletes an unreferenced key
      const resDel = await deleteLogoObjectIfUnreferenced(businessId, unreferencedKey);
      expect(resDel).toBe('deleted');
      expect(state.deletedKeys).toContain(unreferencedKey);

      // 4. Logo Route: GET ?k=<referenced key> serves 200 with immutable header
      const reqRef = new NextRequest(`http://localhost:3000/api/business/${businessId}/logo?k=${encodeURIComponent(referencedKey)}`);
      const respRef = await logoRouteHandler(reqRef, { params: Promise.resolve({ id: businessId }) });
      expect(respRef.status).toBe(200);
      expect(respRef.headers.get('Cache-Control')).toContain('immutable');

      // 5. Logo Route: GET ?k=<unknown/random key> serves 404
      const reqUnknown = new NextRequest(`http://localhost:3000/api/business/${businessId}/logo?k=random-rogue-key.png`);
      const respUnknown = await logoRouteHandler(reqUnknown, { params: Promise.resolve({ id: businessId }) });
      expect(respUnknown.status).toBe(404);
    });
  });
});
