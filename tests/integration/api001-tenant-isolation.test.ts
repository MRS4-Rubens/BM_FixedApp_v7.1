import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ActionResult } from '@/lib/actions/_shared/types';
import * as schema from '@/lib/db/schema';

/**
 * API-001 integration tests. They run the REAL server actions against a REAL in-process PostgreSQL (PGlite) that
 * has every migration applied. Tenant A is the logged-in caller; tenant B is the victim. "Legacy leak" rows (links
 * from A to B's customer/product/invoice) are planted BEFORE the DB-002 migration, exactly like pre-existing bad data.
 */

const state = vi.hoisted(() => ({ db: undefined as unknown, businessId: '' }));

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));
vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({ id: '00000000-0000-0000-0000-000000000001', business_id: state.businessId, role: 'owner' }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: () => undefined }));

import { saveCreditNoteDraft } from '@/lib/actions/credit-notes/save-credit-note-draft';
import { updateCustomer } from '@/lib/actions/customers/update-customer';
import { deactivateProduct } from '@/lib/actions/products/deactivate-product';
import { reactivateProduct } from '@/lib/actions/products/reactivate-product';
import { updateProduct } from '@/lib/actions/products/update-product';
import { getCreditNote } from '@/lib/actions/credit-notes/get-credit-note';
import { finalizeInvoice } from '@/lib/actions/invoices/finalize-invoice';
import { getInvoice } from '@/lib/actions/invoices/get-invoice';
import { listInvoices } from '@/lib/actions/invoices/list-invoices';
import { saveInvoiceDraft } from '@/lib/actions/invoices/save-invoice-draft';
import { getRecentInvoices } from '@/lib/actions/reports/get-recent-invoices';
import { getTopCustomers } from '@/lib/actions/reports/get-top-customers';
import { getTopProducts } from '@/lib/actions/reports/get-top-products';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');
const DB002_SUFFIX = '_db002_tenant_integrity';
const DB002_PART_B_SUFFIX = '_db002b_validate_tenant_fks';
const VICTIM_CUSTOMER_NAME = 'ZZ Victim Customer B';
const VICTIM_CUSTOMER_EMAIL = 'victim-b@example.com';
const VICTIM_PRODUCT_NAME = 'ZZ Victim Product B';
const OWN_CUSTOMER_NAME = 'AA Own Customer A';
const OWN_PRODUCT_NAME = 'AA Own Product A';

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

interface Tenant {
  businessId: string;
  financialYearId: string;
  customerId: string;
  productId: string;
}

async function createTenant(
  pg: PGlite,
  gstin: string,
  label: string,
  customerName: string,
  customerEmail: string,
  productName: string,
): Promise<Tenant> {
  const businessId = await insertOne(
    pg,
    `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
     VALUES ($1, $2, '1 Test Road', 'Bengaluru', '29', '560001') RETURNING id`,
    [`Shop ${label}`, gstin],
  );
  const financialYearId = await insertOne(
    pg,
    `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current)
     VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true) RETURNING id`,
    [businessId],
  );
  const customerId = await insertOne(
    pg,
    `INSERT INTO customers (business_id, name, email, state_code) VALUES ($1, $2, $3, '29') RETURNING id`,
    [businessId, customerName, customerEmail],
  );
  const productId = await insertOne(
    pg,
    `INSERT INTO products (business_id, name, hsn_sac_code, default_sale_price_paise) VALUES ($1, $2, '4820', 5000) RETURNING id`,
    [businessId, productName],
  );
  return { businessId, financialYearId, customerId, productId };
}

/** Plants an invoice (optionally finalized) with ONE line item. Finalized rows are flipped AFTER the line insert, like the real flow. */
async function plantInvoice(
  pg: PGlite,
  owner: Tenant,
  customerId: string | null,
  productId: string | null,
  number: string,
  finalized: boolean,
): Promise<string> {
  const invoiceId = await insertOne(
    pg,
    `INSERT INTO invoices (business_id, financial_year_id, invoice_number, customer_id, place_of_supply_state_code, subtotal_paise, total_tax_paise, grand_total_paise)
     VALUES ($1, $2, $3, $4, '29', 10000, 1800, 11800) RETURNING id`,
    [owner.businessId, owner.financialYearId, number, customerId],
  );
  await pg.query(
    `INSERT INTO invoice_line_items (invoice_id, product_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise, cgst_paise, sgst_paise)
     VALUES ($1, $2, 'Notebook', '4820', 2.000, 'NOS', 5000, 10000, 18.00, 11800, 900, 900)`,
    [invoiceId, productId],
  );
  if (finalized) {
    await pg.query(
      `UPDATE invoices SET invoice_sequence = $2, lifecycle_status = 'finalized', invoice_date = '2026-10-15', due_date = '2026-11-14', finalized_at = now(),
         seller_gstin_snapshot = '29ABCDE1234F1Z5', total_cgst_paise = 900, total_sgst_paise = 900 WHERE id = $1`,
      [invoiceId, Math.floor(Math.random() * 100000) + 1],
    );
  }
  return invoiceId;
}

function expectFailure<T>(result: ActionResult<T>, code: string, message: RegExp): void {
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.code).toBe(code);
    expect(result.error.message).toMatch(message);
  }
}

function expectSuccess<T>(result: ActionResult<T>): T {
  if (!result.success) {
    throw new Error(`expected success but got ${result.error.code}: ${result.error.message}`);
  }
  return result.data;
}

async function countRows(pg: PGlite, table: 'invoices' | 'credit_notes', businessId: string): Promise<number> {
  const result = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE business_id = $1`, [businessId]);
  return result.rows[0]?.n ?? -1;
}

describe('API-001: tenant isolation of customers, products and invoices', () => {
  let pg: PGlite;
  let a: Tenant;
  let b: Tenant;
  let taxRateId: string;
  let leakedDraftId: string;
  let leakedFinalId: string;
  let ownFinalId: string;
  let ownDraftId: string;
  let leakedCreditNoteId: string;
  let victimFinalId: string;

  function draftInput(options: { customerId: string; productId: string; id?: string }): Record<string, unknown> {
    return {
      ...(options.id ? { id: options.id } : {}),
      customer_id: options.customerId,
      billing_name: 'Test Buyer',
      place_of_supply_state_code: '29',
      invoice_date: '2026-10-20',
      gst_rate_type: 'exclusive',
      line_items: [
        {
          product_id: options.productId,
          description: 'Notebook',
          hsn_sac_code: '4820',
          quantity: 2,
          unit_of_measurement: 'NOS',
          unit_price: 50,
          discount: 0,
          tax_rate_id: taxRateId,
        },
      ],
    };
  }

  beforeAll(async () => {
    pg = new PGlite();
    state.db = drizzle(pg, { schema });
    const journal = readJournal();
    const db002Position = journal.findIndex((entry) => entry.tag.endsWith(DB002_SUFFIX));
    if (db002Position < 1) {
      throw new Error(`journal has no migration ending in ${DB002_SUFFIX}`);
    }

    // Phase 1: schema as it was BEFORE DB-002 (cross-tenant links are still possible) -> plant legacy leaks.
    await applyMigrations(pg, journal.slice(0, db002Position));
    taxRateId = await insertOne(pg, `INSERT INTO tax_rates (label, rate_percentage, effective_from) VALUES ('18%', 18, '2017-07-01') RETURNING id`);
    a = await createTenant(pg, '29ABCDE1234F1Z5', 'A', OWN_CUSTOMER_NAME, 'own-a@example.com', OWN_PRODUCT_NAME);
    b = await createTenant(pg, '27ABCDE1234F1Z5', 'B', VICTIM_CUSTOMER_NAME, VICTIM_CUSTOMER_EMAIL, VICTIM_PRODUCT_NAME);

    ownFinalId = await plantInvoice(pg, a, a.customerId, a.productId, 'INV-OWN-1', true);
    ownDraftId = await plantInvoice(pg, a, a.customerId, a.productId, 'DRAFT-OWN-1', false);
    leakedDraftId = await plantInvoice(pg, a, b.customerId, a.productId, 'DRAFT-LEAK-1', false);
    leakedFinalId = await plantInvoice(pg, a, b.customerId, b.productId, 'INV-LEAK-1', true);
    victimFinalId = await plantInvoice(pg, b, b.customerId, b.productId, 'INV-B-1', true);
    leakedCreditNoteId = await insertOne(
      pg,
      `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason)
       VALUES ($1, $2, $3, 'DRAFT-CN-LEAK', '01-sales-return') RETURNING id`,
      [a.businessId, victimFinalId, a.financialYearId],
    );

    // Phase 2: apply DB-002 and everything after it (the legacy leaks above stay, because the keys are NOT VALID).
    // DB-002 PART B is skipped on purpose: it validates the keys and would (correctly) refuse to run while the planted
    // legacy leaks exist. Its behaviour is tested in db002b-validate-tenant-fks.test.ts.
    await applyMigrations(
      pg,
      journal.slice(db002Position).filter((entry) => !entry.tag.endsWith(DB002_PART_B_SUFFIX)),
    );
    state.businessId = a.businessId;

    await pg.query(
      `INSERT INTO users (id, auth_user_id, business_id, email, display_name, role)
       VALUES ('00000000-0000-0000-0000-000000000001', 'auth_001', $1, 'user@test.dev', 'Test User', 'owner')`,
      [a.businessId],
    );
  }, 180_000);

  afterAll(async () => {
    await pg.close();
  });

  describe('writes: saveInvoiceDraft', () => {
    it("rejects another business's customer and creates nothing", async () => {
      const before = await countRows(pg, 'invoices', a.businessId);
      const result = await saveInvoiceDraft(draftInput({ customerId: b.customerId, productId: a.productId }));
      expectFailure(result, 'NOT_FOUND', /Customer not found/);
      expect(await countRows(pg, 'invoices', a.businessId)).toBe(before);
    });

    it("rejects another business's product and creates nothing", async () => {
      const before = await countRows(pg, 'invoices', a.businessId);
      const result = await saveInvoiceDraft(draftInput({ customerId: a.customerId, productId: b.productId }));
      expectFailure(result, 'NOT_FOUND', /products were not found/);
      expect(await countRows(pg, 'invoices', a.businessId)).toBe(before);
    });

    it("refuses to re-point an existing own draft to another business's customer (draft stays unchanged)", async () => {
      const result = await saveInvoiceDraft(draftInput({ id: ownDraftId, customerId: b.customerId, productId: a.productId }));
      expectFailure(result, 'NOT_FOUND', /Customer not found/);
      const row = await pg.query<{ customer_id: string }>(`SELECT customer_id FROM invoices WHERE id = $1`, [ownDraftId]);
      expect(row.rows[0]?.customer_id).toBe(a.customerId);
    });

    it('re-saving a draft records the time in updated_at (CodeRabbit, PR #73)', async () => {
      const draft = expectSuccess(await saveInvoiceDraft(draftInput({ customerId: a.customerId, productId: a.productId })));
      await pg.query(`UPDATE invoices SET updated_at = '2020-01-01T00:00:00Z' WHERE id = $1`, [draft.invoiceId]);
      expectSuccess(await saveInvoiceDraft(draftInput({ id: draft.invoiceId, customerId: a.customerId, productId: a.productId })));
      const row = await pg.query<{ updated_at: Date }>(`SELECT updated_at FROM invoices WHERE id = $1`, [draft.invoiceId]);
      expect(new Date(row.rows[0]?.updated_at ?? 0).getUTCFullYear()).toBeGreaterThan(2020);
    });

    it('accepts own customer and own product, and also walk-in customers / ad-hoc lines', async () => {
      const own = expectSuccess(await saveInvoiceDraft(draftInput({ customerId: a.customerId, productId: a.productId })));
      expect(own.invoiceId).toMatch(/^[0-9a-f-]{36}$/);
      const walkIn = expectSuccess(await saveInvoiceDraft(draftInput({ customerId: '', productId: '' })));
      expect(walkIn.invoiceId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  // TEST-02: replaces a switched-off block (product-based input, superseded by API-004 line binding) that left the
  // cross-tenant credit-note path untested.
  describe("writes: saveCreditNoteDraft only against the caller's own invoices", () => {
    async function firstLineId(invoiceId: string): Promise<string> {
      const result = await pg.query<{ id: string }>('SELECT id FROM invoice_line_items WHERE invoice_id = $1 LIMIT 1', [invoiceId]);
      const id = result.rows[0]?.id;
      if (!id) throw new Error('invoice has no line items');
      return id;
    }

    it("rejects another business's finalized invoice with NOT_FOUND and creates nothing anywhere", async () => {
      const lineId = await firstLineId(victimFinalId);
      const ownBefore = await countRows(pg, 'credit_notes', a.businessId);
      const victimBefore = await countRows(pg, 'credit_notes', b.businessId);
      expectFailure(
        await saveCreditNoteDraft({
          original_invoice_id: victimFinalId,
          reason: '01-sales-return',
          line_items: [{ original_line_item_id: lineId, quantity: 1 }],
        }),
        'NOT_FOUND',
        /^Original invoice not found.$/,
      );
      expect(await countRows(pg, 'credit_notes', a.businessId)).toBe(ownBefore);
      expect(await countRows(pg, 'credit_notes', b.businessId)).toBe(victimBefore);
    });

    it('accepts a credit note against an own finalized invoice', async () => {
      const lineId = await firstLineId(ownFinalId);
      const data = expectSuccess(
        await saveCreditNoteDraft({
          original_invoice_id: ownFinalId,
          reason: '01-sales-return',
          line_items: [{ original_line_item_id: lineId, quantity: 1 }],
        }),
      );
      expect(data.id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  // TEST-02: the master-data write actions had no cross-tenant behaviour test.
  describe("writes: another business's customer or product can never be changed", () => {
    // Scoped by the expected owner, so an ownership change would also show up as a missing row.
    async function productRow(id: string, businessId: string) {
      return (
        await pg.query<{ name: string; is_active: boolean }>(
          'SELECT name, is_active FROM products WHERE id = $1 AND business_id = $2',
          [id, businessId],
        )
      ).rows[0];
    }
    async function customerRow(id: string, businessId: string) {
      return (
        await pg.query<{ name: string; is_active: boolean }>(
          'SELECT name, is_active FROM customers WHERE id = $1 AND business_id = $2',
          [id, businessId],
        )
      ).rows[0];
    }

    it('updateProduct: NOT_FOUND, victim product unchanged', async () => {
      const before = await productRow(b.productId, b.businessId);
      expectFailure(
        await updateProduct({
          id: b.productId,
          name: 'Hijacked',
          description: '',
          hsn_sac_code: '4820',
          unit_of_measurement: 'NOS',
          default_sale_price: 1,
          default_tax_rate_id: '',
          stock_quantity: '',
        }),
        'NOT_FOUND',
        /^Product not found.$/,
      );
      expect(await productRow(b.productId, b.businessId)).toEqual(before);
      expect(before?.name).toBe(VICTIM_PRODUCT_NAME);
    });

    it('deactivateProduct and reactivateProduct: NOT_FOUND, victim product unchanged', async () => {
      const before = await productRow(b.productId, b.businessId);
      expectFailure(await deactivateProduct({ id: b.productId }), 'NOT_FOUND', /^Product not found.$/);
      expect(await productRow(b.productId, b.businessId)).toEqual(before);
      await pg.query('UPDATE products SET is_active = false WHERE id = $1', [b.productId]);
      expectFailure(await reactivateProduct({ id: b.productId }), 'NOT_FOUND', /^Product not found.$/);
      expect((await productRow(b.productId, b.businessId))?.is_active).toBe(false);
      await pg.query('UPDATE products SET is_active = true WHERE id = $1', [b.productId]);
    });

    it('updateCustomer: NOT_FOUND, victim customer unchanged', async () => {
      const before = await customerRow(b.customerId, b.businessId);
      expectFailure(
        await updateCustomer({
          id: b.customerId,
          name: 'Hijacked',
          gstin: '',
          email: '',
          phone: '',
          address_line1: '',
          address_line2: '',
          city: '',
          state_code: '27',
          pincode: '',
        }),
        'NOT_FOUND',
        /^Customer not found.$/,
      );
      expect(await customerRow(b.customerId, b.businessId)).toEqual(before);
      expect(before?.name).toBe(VICTIM_CUSTOMER_NAME);
    });

    it("the same actions still work on the caller's own rows (the guard is not a blanket refusal)", async () => {
      expectSuccess(await deactivateProduct({ id: a.productId }));
      expect((await productRow(a.productId, a.businessId))?.is_active).toBe(false);
      expectSuccess(await reactivateProduct({ id: a.productId }));
      expect((await productRow(a.productId, a.businessId))?.is_active).toBe(true);
    });
  });

  describe('finalize: the customer snapshot may only come from the caller\'s own customers', () => {
    it("refuses to copy another business's customer into a snapshot (legacy leaked draft)", async () => {
      const result = await finalizeInvoice({ id: leakedDraftId });
      expectFailure(result, 'NOT_FOUND', /Customer not found/);
      const row = await pg.query<{ lifecycle_status: string; billing_name_snapshot: string | null }>(
        `SELECT lifecycle_status::text AS lifecycle_status, billing_name_snapshot FROM invoices WHERE id = $1`,
        [leakedDraftId],
      );
      expect(row.rows[0]?.lifecycle_status).toBe('draft');
      expect(row.rows[0]?.billing_name_snapshot ?? '').not.toContain(VICTIM_CUSTOMER_NAME);
    });

    it('still finalizes a normal draft with an own customer and snapshots the OWN customer', async () => {
      const saved = expectSuccess(await saveInvoiceDraft(draftInput({ customerId: a.customerId, productId: a.productId })));
      const finalized = expectSuccess(await finalizeInvoice({ id: saved.invoiceId }));
      expect(JSON.stringify(finalized)).not.toContain(VICTIM_CUSTOMER_NAME);
      const row = await pg.query<{ lifecycle_status: string; billing_name_snapshot: string | null }>(
        `SELECT lifecycle_status::text AS lifecycle_status, billing_name_snapshot FROM invoices WHERE id = $1`,
        [saved.invoiceId],
      );
      expect(row.rows[0]?.lifecycle_status).toBe('finalized');
      expect(row.rows[0]?.billing_name_snapshot).toBe(OWN_CUSTOMER_NAME);
    });
  });

  describe('reads: nothing of another business may be returned', () => {
    it('getInvoice: another business\'s invoice and a missing id fail identically with NOT_FOUND', async () => {
      // Same code and message for both, so the response never reveals that the other business's id exists.
      expectFailure(await getInvoice({ id: victimFinalId }), 'NOT_FOUND', /^Invoice not found\.$/);
      expectFailure(await getInvoice({ id: '00000000-0000-4000-8000-000000000000' }), 'NOT_FOUND', /^Invoice not found\.$/);
    });

    it('getInvoice returns no customer data for a legacy leaked link, but returns the own customer normally', async () => {
      const leaked = expectSuccess(await getInvoice({ id: leakedFinalId }));
      const text = JSON.stringify(leaked);
      expect(text).not.toContain(VICTIM_CUSTOMER_NAME);
      expect(text).not.toContain(VICTIM_CUSTOMER_EMAIL);
      const own = expectSuccess(await getInvoice({ id: ownFinalId }));
      expect(JSON.stringify(own)).toContain(OWN_CUSTOMER_NAME);
    });

    it('listInvoices does not show the victim customer name but shows own customer names', async () => {
      const rows = expectSuccess(await listInvoices({}));
      const text = JSON.stringify(rows);
      expect(text).not.toContain(VICTIM_CUSTOMER_NAME);
      expect(text).toContain(OWN_CUSTOMER_NAME);
    });

    it('getRecentInvoices does not show the victim customer name but shows own customer names', async () => {
      const rows = expectSuccess(await getRecentInvoices({ limit: 50 }));
      const text = JSON.stringify(rows);
      expect(text).not.toContain(VICTIM_CUSTOMER_NAME);
      expect(text).toContain(OWN_CUSTOMER_NAME);
    });

    it('getTopCustomers does not rank the victim customer but ranks own customers', async () => {
      const data = expectSuccess(await getTopCustomers({ startDate: '2026-10-01', endDate: '2026-10-31' }));
      const text = JSON.stringify(data);
      expect(text).not.toContain(VICTIM_CUSTOMER_NAME);
      expect(text).toContain(OWN_CUSTOMER_NAME);
    });

    it('getTopProducts does not show the victim product name but shows own product names', async () => {
      const data = expectSuccess(await getTopProducts({ startDate: '2026-10-01', endDate: '2026-10-31' }));
      const text = JSON.stringify(data);
      expect(text).not.toContain(VICTIM_PRODUCT_NAME);
      expect(text).toContain(OWN_PRODUCT_NAME);
    });

    it("getCreditNote refuses to load another business's invoice as the 'original invoice'", async () => {
      expectFailure(await getCreditNote({ id: leakedCreditNoteId }), 'NOT_FOUND', /Original invoice not found/);
    });
  });
});
