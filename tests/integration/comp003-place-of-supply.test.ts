import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/client';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: '00000000-0000-4000-8000-000000000001',
  businessId: '00000000-0000-4000-8000-000000000010',
}));

vi.mock('@/lib/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/client')>();
  return {
    ...actual,
    get db() {
      return state.db;
    },
  };
});

vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({
    id: state.userId,
    business_id: state.businessId,
  }),
}));

vi.mock('@/lib/auth/server', () => ({
  auth: {
    getSession: async () => ({
      data: {
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          email: 'owner@test.dev',
          emailVerified: true,
        },
      },
    }),
  },
}));

vi.mock('@/lib/email/resend', () => ({
  getResend: () => ({
    emails: {
      send: async () => ({ id: 'mock-email-id' }),
    },
  }),
}));

vi.mock('@/lib/env', () => ({
  getAppEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://test.app' }),
  getEmailEnv: () => ({ RESEND_FROM_EMAIL: 'noreply@test.app' }),
  getAdminEnv: () => ({
    PLATFORM_ADMIN_EMAILS: ['admin@test.app'],
    PLATFORM_ADMIN_USER_IDS: ['00000000-0000-4000-8000-000000000099'],
  }),
  getArchivalEnv: () => ({ ARCHIVAL_SIGNING_SECRET: 'mock-archival-secret-mock-archival-secret' }),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}));

vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));

vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: () => undefined,
}));

vi.mock('@/lib/storage/schedule-archival', () => ({
  scheduleArchival: () => undefined,
}));

import { saveInvoiceDraft } from '@/lib/actions/invoices/save-invoice-draft';
import { finalizeInvoice } from '@/lib/actions/invoices/finalize-invoice';
import { calculateInvoiceTax } from '@/lib/gst/calculate';
import { roundToRupeePaise } from '@/lib/credit-notes/derivation';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

interface JournalEntry {
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
    if (!isRecord(entry) || typeof entry.tag !== 'string') {
      throw new Error('malformed journal entry');
    }
    return { tag: entry.tag };
  });
}

function statementsOf(tag: string): readonly string[] {
  return readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applyMigrations(pg: PGlite, tags: readonly string[]): Promise<void> {
  for (const tag of tags) {
    for (const stmt of statementsOf(tag)) {
      await pg.exec(stmt);
    }
  }
}

interface IdRow {
  readonly id: string;
}

async function insertOne(pg: PGlite, query: string, params: readonly unknown[] = []): Promise<string> {
  const res = await pg.query<IdRow>(query, params as unknown[]);
  const id = res.rows[0]?.id;
  if (!id) throw new Error(`Query returned no id: ${query}`);
  return id;
}

describe('COMP-003: Place of supply & totals integrity integration (PGlite)', () => {
  let pg: PGlite;
  let sellerBizId: string;
  let sellerUserId: string;
  let sellerFyId: string;
  let taxRate18Id: string;
  let taxRate12Id: string;
  let taxRate5Id: string;
  let customerKarnatakaId: string;
  let customerMaharashtraId: string;
  let foreignCustomerBizBId: string;

  beforeAll(async () => {
    pg = new PGlite();
    const journal = readJournal();
    await applyMigrations(pg, journal.map((j) => j.tag));
    const db = drizzle(pg, { schema });
    state.db = db;

    // Seller in Karnataka (state_code: 29)
    sellerBizId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status, trial_ends_at
      ) VALUES (
        'Karnataka Seller Corp', '29ABCDE1234F1Z5', '100 MG Road', 'Bengaluru', '29', '560001',
        'professional', 'active', NULL
      ) RETURNING id`,
    );

    sellerUserId = await insertOne(
      pg,
      `INSERT INTO users (business_id, auth_user_id, email, display_name, role)
       VALUES ($1, 'auth-seller-1', 'seller@karnataka.dev', 'Karnataka Seller', 'owner') RETURNING id`,
      [sellerBizId],
    );

    sellerFyId = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true) RETURNING id`,
      [sellerBizId],
    );

    // Active GST rates
    taxRate18Id = await insertOne(
      pg,
      `INSERT INTO tax_rates (label, rate_percentage, is_active, effective_from)
       VALUES ('GST 18%', '18.00', true, '2020-01-01') RETURNING id`,
    );
    taxRate12Id = await insertOne(
      pg,
      `INSERT INTO tax_rates (label, rate_percentage, is_active, effective_from)
       VALUES ('GST 12%', '12.00', true, '2020-01-01') RETURNING id`,
    );
    taxRate5Id = await insertOne(
      pg,
      `INSERT INTO tax_rates (label, rate_percentage, is_active, effective_from)
       VALUES ('GST 5%', '5.00', true, '2020-01-01') RETURNING id`,
    );

    // Customer registered in Karnataka (state_code: 29)
    customerKarnatakaId = await insertOne(
      pg,
      `INSERT INTO customers (business_id, name, state_code, city, pincode, gstin)
       VALUES ($1, 'Local Karnataka Buyer', '29', 'Bengaluru', '560002', '29XYZAB1234C1Z1') RETURNING id`,
      [sellerBizId],
    );

    // Customer registered in Maharashtra (state_code: 27)
    customerMaharashtraId = await insertOne(
      pg,
      `INSERT INTO customers (business_id, name, state_code, city, pincode, gstin)
       VALUES ($1, 'Maharashtra Buyer', '27', 'Mumbai', '400001', '27AAPFU0939F1ZY') RETURNING id`,
      [sellerBizId],
    );

    // Another business (Biz B) for tenant isolation test
    const foreignBizId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status
      ) VALUES (
        'Foreign Biz B', '27AAPFU0939F1ZZ', '20 Church St', 'Pune', '27', '411001',
        'free', 'active'
      ) RETURNING id`,
    );
    foreignCustomerBizBId = await insertOne(
      pg,
      `INSERT INTO customers (business_id, name, state_code, city, pincode)
       VALUES ($1, 'Biz B Customer', '27', 'Pune', '411001') RETURNING id`,
      [foreignBizId],
    );

    state.businessId = sellerBizId;
    state.userId = sellerUserId;
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  it('1. AC-1: Customer in 29 + draft PoS 27 -> finalize keeps 27, IGST only, CGST=SGST=0, totals match draft', async () => {
    const saveRes = await saveInvoiceDraft({
      customer_id: customerKarnatakaId,
      billing_name: 'Local Karnataka Buyer',
      place_of_supply_state_code: '27', // Explicit delivery state: Maharashtra (inter-state!)
      invoice_date: '2026-05-10',
      line_items: [
        {
          description: 'Consulting',
          hsn_sac_code: '998311',
          quantity: 1,
          unit_of_measurement: 'NOS',
          unit_price: 1000,
          discount: 0,
          tax_rate_id: taxRate18Id,
        },
      ],
    });
    expect(saveRes.success).toBe(true);
    if (!saveRes.success) return;

    const invoiceId = saveRes.data.invoiceId;

    const finRes = await finalizeInvoice({ id: invoiceId });
    expect(finRes.success).toBe(true);
    if (!finRes.success) return;

    const rows = await pg.query<{
      place_of_supply_state_code: string;
      total_cgst_paise: number;
      total_sgst_paise: number;
      total_igst_paise: number;
      grand_total_paise: number;
    }>(
      `SELECT place_of_supply_state_code, total_cgst_paise, total_sgst_paise, total_igst_paise, grand_total_paise
       FROM invoices WHERE id = $1`,
      [invoiceId],
    );

    const row = rows.rows[0];
    expect(row.place_of_supply_state_code).toBe('27');
    expect(row.total_igst_paise).toBe(18000);
    expect(row.total_cgst_paise).toBe(0);
    expect(row.total_sgst_paise).toBe(0);
    expect(row.grand_total_paise).toBe(118000);
  });

  it('2. AC-2: Customer in 27 + draft PoS 29 -> finalize keeps 29, intra-state CGST+SGST, IGST=0', async () => {
    const saveRes = await saveInvoiceDraft({
      customer_id: customerMaharashtraId,
      billing_name: 'Maharashtra Buyer',
      place_of_supply_state_code: '29', // Delivery in Karnataka (seller state -> intra-state)
      invoice_date: '2026-05-11',
      line_items: [
        {
          description: 'Local Delivery Service',
          hsn_sac_code: '998311',
          quantity: 2,
          unit_of_measurement: 'NOS',
          unit_price: 500,
          discount: 0,
          tax_rate_id: taxRate18Id,
        },
      ],
    });
    expect(saveRes.success).toBe(true);
    if (!saveRes.success) return;

    const invoiceId = saveRes.data.invoiceId;

    const finRes = await finalizeInvoice({ id: invoiceId });
    expect(finRes.success).toBe(true);
    if (!finRes.success) return;

    const rows = await pg.query<{
      place_of_supply_state_code: string;
      total_cgst_paise: number;
      total_sgst_paise: number;
      total_igst_paise: number;
      grand_total_paise: number;
    }>(
      `SELECT place_of_supply_state_code, total_cgst_paise, total_sgst_paise, total_igst_paise, grand_total_paise
       FROM invoices WHERE id = $1`,
      [invoiceId],
    );

    const row = rows.rows[0];
    expect(row.place_of_supply_state_code).toBe('29');
    expect(row.total_cgst_paise).toBe(9000);
    expect(row.total_sgst_paise).toBe(9000);
    expect(row.total_igst_paise).toBe(0);
    expect(row.grand_total_paise).toBe(118000);
  });

  it('3. Walk-in (no customer) + draft PoS 27 -> PoS kept, IGST applied', async () => {
    const saveRes = await saveInvoiceDraft({
      billing_name: 'Walk-in Customer From Mumbai',
      place_of_supply_state_code: '27',
      invoice_date: '2026-05-12',
      line_items: [
        {
          description: 'Counter Sale Delivery to MH',
          hsn_sac_code: '998311',
          quantity: 1,
          unit_of_measurement: 'NOS',
          unit_price: 2000,
          discount: 0,
          tax_rate_id: taxRate18Id,
        },
      ],
    });
    expect(saveRes.success).toBe(true);
    if (!saveRes.success) return;

    const invoiceId = saveRes.data.invoiceId;

    const finRes = await finalizeInvoice({ id: invoiceId });
    expect(finRes.success).toBe(true);
    if (!finRes.success) return;

    const rows = await pg.query<{
      place_of_supply_state_code: string;
      total_igst_paise: number;
    }>(
      `SELECT place_of_supply_state_code, total_igst_paise FROM invoices WHERE id = $1`,
      [invoiceId],
    );
    expect(rows.rows[0].place_of_supply_state_code).toBe('27');
    expect(rows.rows[0].total_igst_paise).toBe(36000);
  });

  it('4. AC-4: Tampered draft returns DRAFT_TOTALS_MISMATCH, leaves draft untouched, consumes no sequence', async () => {
    const saveRes = await saveInvoiceDraft({
      billing_name: 'Tamper Target Buyer',
      place_of_supply_state_code: '27',
      invoice_date: '2026-05-14',
      line_items: [
        {
          description: 'Widget',
          hsn_sac_code: '998311',
          quantity: 1,
          unit_of_measurement: 'NOS',
          unit_price: 1000,
          discount: 0,
          tax_rate_id: taxRate18Id,
        },
      ],
    });
    expect(saveRes.success).toBe(true);
    if (!saveRes.success) return;

    const invoiceId = saveRes.data.invoiceId;

    // Snapshot counters and line items before tampering
    const beforeCounters = await pg.query<{ counter_value: number }>(
      `SELECT counter_value FROM invoice_number_counters WHERE business_id = $1`,
      [sellerBizId],
    );
    const beforeCounterVal = beforeCounters.rows[0]?.counter_value ?? 0;

    // Tamper IGST on draft by adding 100 paise
    await pg.query(`UPDATE invoices SET total_igst_paise = total_igst_paise + 100 WHERE id = $1`, [invoiceId]);

    const finRes1 = await finalizeInvoice({ id: invoiceId });
    expect(finRes1.success).toBe(false);
    if (!finRes1.success) {
      expect(finRes1.error.code).toBe('DRAFT_TOTALS_MISMATCH');
      expect(finRes1.error.message).toContain('IGST');
    }

    // Verify invoice is still draft, no sequence assigned
    const check1 = await pg.query<{ lifecycle_status: string; invoice_sequence: number | null }>(
      `SELECT lifecycle_status, invoice_sequence FROM invoices WHERE id = $1`,
      [invoiceId],
    );
    expect(check1.rows[0].lifecycle_status).toBe('draft');
    expect(check1.rows[0].invoice_sequence).toBeNull();

    // Verify counters unchanged
    const afterCounters1 = await pg.query<{ counter_value: number }>(
      `SELECT counter_value FROM invoice_number_counters WHERE business_id = $1`,
      [sellerBizId],
    );
    expect(afterCounters1.rows[0]?.counter_value ?? 0).toBe(beforeCounterVal);

    // Tamper subtotal_paise separately
    await pg.query(`UPDATE invoices SET subtotal_paise = subtotal_paise + 1000 WHERE id = $1`, [invoiceId]);

    const finRes2 = await finalizeInvoice({ id: invoiceId });
    expect(finRes2.success).toBe(false);
    if (!finRes2.success) {
      expect(finRes2.error.code).toBe('DRAFT_TOTALS_MISMATCH');
      expect(finRes2.error.message).toContain('subtotal');
    }

    // After re-saving the draft, finalizing must succeed cleanly
    const reSaveRes = await saveInvoiceDraft({
      id: invoiceId,
      billing_name: 'Tamper Target Buyer',
      place_of_supply_state_code: '27',
      invoice_date: '2026-05-14',
      line_items: [
        {
          description: 'Widget',
          hsn_sac_code: '998311',
          quantity: 1,
          unit_of_measurement: 'NOS',
          unit_price: 1000,
          discount: 0,
          tax_rate_id: taxRate18Id,
        },
      ],
    });
    expect(reSaveRes.success).toBe(true);

    const finRes3 = await finalizeInvoice({ id: invoiceId });
    expect(finRes3.success).toBe(true);
  });

  it('5. AC-3: Stored PoS NULL and "99" aborts with INVALID_PLACE_OF_SUPPLY without silent fallback', async () => {
    // 5a. Stored PoS is NULL
    const invIdNull = await insertOne(
      pg,
      `INSERT INTO invoices (
        business_id, financial_year_id, invoice_number, lifecycle_status, invoice_date,
        place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, total_tax_paise, grand_total_paise
      ) VALUES ($1, $2, 'DRAFT-NULL-POS', 'draft', '2026-05-15', NULL, 10000, 900, 900, 0, 1800, 11800) RETURNING id`,
      [sellerBizId, sellerFyId],
    );
    await pg.query(
      `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, 'Item', '998311', 1.000, 'NOS', 10000, 10000, 18.00, 11800)`,
      [invIdNull],
    );

    const finResNull = await finalizeInvoice({ id: invIdNull });
    expect(finResNull.success).toBe(false);
    if (!finResNull.success) {
      expect(finResNull.error.code).toBe('INVALID_PLACE_OF_SUPPLY');
    }

    // 5b. Stored PoS is '99'
    const invId99 = await insertOne(
      pg,
      `INSERT INTO invoices (
        business_id, financial_year_id, invoice_number, lifecycle_status, invoice_date,
        place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, total_tax_paise, grand_total_paise
      ) VALUES ($1, $2, 'DRAFT-99-POS', 'draft', '2026-05-15', '99', 10000, 900, 900, 0, 1800, 11800) RETURNING id`,
      [sellerBizId, sellerFyId],
    );
    await pg.query(
      `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
       VALUES ($1, 'Item', '998311', 1.000, 'NOS', 10000, 10000, 18.00, 11800)`,
      [invId99],
    );

    const finRes99 = await finalizeInvoice({ id: invId99 });
    expect(finRes99.success).toBe(false);
    if (!finRes99.success) {
      expect(finRes99.error.code).toBe('INVALID_PLACE_OF_SUPPLY');
    }
  });

  it('6. AC-5: No false positives across various quantities, discounts, modes, and mixed rates', async () => {
    // 6a. Multi-decimal quantity (3 decimals) with 10% discount
    const draft1 = await saveInvoiceDraft({
      billing_name: 'Precision Test 1',
      place_of_supply_state_code: '29',
      invoice_date: '2026-05-16',
      line_items: [
        {
          description: 'Bulk Sugar',
          hsn_sac_code: '170114',
          quantity: 2.999,
          unit_of_measurement: 'KGS',
          unit_price: 45.5,
          discount: 10,
          tax_rate_id: taxRate5Id,
        },
      ],
    });
    expect(draft1.success).toBe(true);
    if (draft1.success) {
      const fin1 = await finalizeInvoice({ id: draft1.data.invoiceId });
      expect(fin1.success).toBe(true);
    }

    // 6b. Small quantity 0.001 NOS
    const draft2 = await saveInvoiceDraft({
      billing_name: 'Precision Test 2',
      place_of_supply_state_code: '27',
      invoice_date: '2026-05-16',
      line_items: [
        {
          description: 'Precision Micro Gram',
          hsn_sac_code: '998311',
          quantity: 0.001,
          unit_of_measurement: 'NOS',
          unit_price: 100000,
          discount: 0,
          tax_rate_id: taxRate18Id,
        },
      ],
    });
    expect(draft2.success).toBe(true);
    if (draft2.success) {
      const fin2 = await finalizeInvoice({ id: draft2.data.invoiceId });
      expect(fin2.success).toBe(true);
    }

    // 6c. Inclusive GST rate mode with mixed line items (5%, 12%, 18%)
    const draft3 = await saveInvoiceDraft({
      billing_name: 'Inclusive Mixed Test',
      place_of_supply_state_code: '29',
      invoice_date: '2026-05-16',
      gst_rate_type: 'inclusive',
      line_items: [
        {
          description: 'Item 5%',
          hsn_sac_code: '998311',
          quantity: 3,
          unit_of_measurement: 'NOS',
          unit_price: 105,
          discount: 5,
          tax_rate_id: taxRate5Id,
        },
        {
          description: 'Item 12%',
          hsn_sac_code: '998311',
          quantity: 1.5,
          unit_of_measurement: 'NOS',
          unit_price: 224,
          discount: 0,
          tax_rate_id: taxRate12Id,
        },
        {
          description: 'Item 18%',
          hsn_sac_code: '998311',
          quantity: 2,
          unit_of_measurement: 'NOS',
          unit_price: 590,
          discount: 10,
          tax_rate_id: taxRate18Id,
        },
      ],
    });
    expect(draft3.success).toBe(true);
    if (draft3.success) {
      const fin3 = await finalizeInvoice({ id: draft3.data.invoiceId });
      expect(fin3.success).toBe(true);
    }

    // 6d. Directly planted draft with quantity 1.2345 stored as 1.235
    const storedQty = 1.235;
    const unitPricePaise = 10000;
    const calc = calculateInvoiceTax({
      sellerStateCode: '29',
      placeOfSupplyStateCode: '29',
      lineItems: [
        {
          quantity: storedQty,
          unitPricePaise,
          discountPaise: 0,
          taxRatePercentage: 18,
        },
      ],
      gstRateType: 'exclusive',
    });

    const plantedId = await insertOne(
      pg,
      `INSERT INTO invoices (
        business_id, financial_year_id, invoice_number, lifecycle_status, invoice_date,
        place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
        total_tax_paise, grand_total_paise
      ) VALUES ($1, $2, 'DRAFT-PLANTED-QTY', 'draft', '2026-05-16', '29', $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        sellerBizId,
        sellerFyId,
        calc.subtotalPaise,
        calc.totalCgstPaise,
        calc.totalSgstPaise,
        calc.totalIgstPaise,
        calc.totalTaxPaise,
        roundToRupeePaise(calc.grandTotalPaise),
      ],
    );
    await pg.query(
      `INSERT INTO invoice_line_items (
        invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
        taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise
      ) VALUES ($1, 'Item', '998311', '1.235', 'NOS', 10000, $2, '18.00', $3, $4, $5, $6)`,
      [
        plantedId,
        calc.lineItems[0].taxableValuePaise,
        calc.lineItems[0].cgstPaise,
        calc.lineItems[0].sgstPaise,
        calc.lineItems[0].igstPaise,
        calc.lineItems[0].lineTotalPaise,
      ],
    );

    const finPlanted = await finalizeInvoice({ id: plantedId });
    expect(finPlanted.success).toBe(true);
  });

  it('7. AC-6: saveInvoiceDraft rejects invalid state code "99"', async () => {
    const res = await saveInvoiceDraft({
      billing_name: 'Invalid State Buyer',
      place_of_supply_state_code: '99', // Invalid GST state code
      line_items: [
        {
          description: 'Item',
          hsn_sac_code: '998311',
          quantity: 1,
          unit_of_measurement: 'NOS',
          unit_price: 100,
          discount: 0,
          tax_rate_id: taxRate18Id,
        },
      ],
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe('VALIDATION_ERROR');
      expect(res.error.fieldErrors?.place_of_supply_state_code).toBeDefined();
    }
  });

  it('8. AC-7: Draft referencing foreign tenant customer fails with NOT_FOUND before PoS evaluation', async () => {
    // Drop composite tenant foreign key to simulate legacy leaked draft pointing to another tenant's customer
    await pg.exec(`ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_customer_same_biz"`);

    let foreignDraftId = '';
    try {
      foreignDraftId = await insertOne(
        pg,
        `INSERT INTO invoices (
          business_id, customer_id, financial_year_id, invoice_number, lifecycle_status, invoice_date,
          place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, total_tax_paise, grand_total_paise
        ) VALUES ($1, $2, $3, 'DRAFT-FOREIGN-CUST', 'draft', '2026-05-17', '99', 10000, 900, 900, 0, 1800, 11800) RETURNING id`,
        [sellerBizId, foreignCustomerBizBId, sellerFyId],
      );
      await pg.query(
        `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise)
         VALUES ($1, 'Item', '998311', 1.000, 'NOS', 10000, 10000, 18.00, 11800)`,
        [foreignDraftId],
      );

      const finRes = await finalizeInvoice({ id: foreignDraftId });
      expect(finRes.success).toBe(false);
      if (!finRes.success) {
        // Must fail with NOT_FOUND because ownership check runs BEFORE resolveDraftPlaceOfSupply
        expect(finRes.error.code).toBe('NOT_FOUND');
        expect(finRes.error.message).toBe('Customer not found.');
      }
    } finally {
      if (foreignDraftId) {
        await pg.query(`DELETE FROM invoice_line_items WHERE invoice_id = $1`, [foreignDraftId]);
        await pg.query(`DELETE FROM invoices WHERE id = $1`, [foreignDraftId]);
      }
      // Re-enable composite constraint
      await pg.exec(
        `ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_same_biz" FOREIGN KEY ("business_id","customer_id") REFERENCES "customers"("business_id","id")`,
      );
    }
  });
});
