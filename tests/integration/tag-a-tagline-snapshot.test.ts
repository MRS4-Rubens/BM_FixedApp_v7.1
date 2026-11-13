import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import { formatIstDateAsIso } from '@/lib/invoices/ist-date';
import { getIndianFinancialYearForDate } from '@/lib/invoices/financial-year';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: '00000000-0000-4000-8000-000000000001',
  businessId: '',
}));

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({
    id: state.userId,
    auth_user_id: `auth_${state.userId}`,
    email: 'owner@test.dev',
    business_id: state.businessId,
    role: 'owner' as const,
    display_name: 'Test Owner',
    created_at: new Date(),
    updated_at: new Date(),
  }),
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: () => undefined }));
vi.mock('@/lib/storage/schedule-archival', () => ({ scheduleArchival: vi.fn() }));

import { finalizeDraftInvoiceInTransaction } from '@/lib/invoices/finalize-invoice-tx';
import { finalizeDraftCreditNoteInTransaction } from '@/lib/invoices/finalize-credit-note-tx';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

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
    const fileContent = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8');
    const statements = fileContent
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
  if (!row) {
    throw new Error(`no row returned for: ${sqlText}`);
  }
  return row.id;
}

describe('SPEC: TAG-A Invoice tagline snapshot & immutability integration', () => {
  let pg: PGlite;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ormDb: any;
  let businessId: string;
  let customerId: string;
  let fyId: string;

  const INITIAL_TAGLINE = 'WHOLESALERS & RETAILERS OF TEXT BOOKS & STATIONERY';

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg, readJournal());
    ormDb = drizzle(pg, { schema });
    state.db = ormDb;

    businessId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, trade_name, gstin, pan, address_line1, city, state_code, pincode,
        nature_of_business, invoice_tagline, subscription_plan, subscription_status
      ) VALUES (
        'Alpha Enterprise', 'Alpha Corp', '27AABCU9603R1ZM', 'AABCU9603R', '101 Street',
        'Mumbai', '27', '400001', 'Retail', $1, 'essentials', 'active'
      ) RETURNING id`,
      [INITIAL_TAGLINE],
    );
    state.businessId = businessId;

    await pg.query(
      `INSERT INTO users (
        id, auth_user_id, email, business_id, role, display_name
      ) VALUES ($1, $2, $3, $4, 'owner', 'Test Owner')`,
      [state.userId, `auth_${state.userId}`, 'owner@test.dev', businessId],
    );

    const now = new Date();
    const fy = getIndianFinancialYearForDate(now);
    fyId = await insertOne(
      pg,
      `INSERT INTO financial_years (
        business_id, label, start_date, end_date
      ) VALUES ($1, $2, $3, $4) RETURNING id`,
      [businessId, fy.label, formatIstDateAsIso(fy.startDate), formatIstDateAsIso(fy.endDate)],
    );

    customerId = await insertOne(
      pg,
      `INSERT INTO customers (
        business_id, name, gstin, state_code, address_line1, city, pincode
      ) VALUES (
        $1, 'Client Customer', '27BBBCE1234F1Z5', '27', '456 Market', 'Mumbai', '400002'
      ) RETURNING id`,
      [businessId],
    );
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  it('1. finalizing an invoice copies invoice_tagline into seller_tagline_snapshot', async () => {
    const draftInvoiceId = await insertOne(
      pg,
      `INSERT INTO invoices (
        business_id, customer_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, due_date,
        place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
        total_tax_paise, grand_total_paise
      ) VALUES (
        $1, $2, $3, 'INV-TAG-001', 'draft', CURRENT_DATE, CURRENT_DATE + interval '30 days',
        '27', 100000, 9000, 9000, 0, 18000, 118000
      ) RETURNING id`,
      [businessId, customerId, fyId],
    );

    await insertOne(
      pg,
      `INSERT INTO invoice_line_items (
        invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
        taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise
      ) VALUES (
        $1, 'Books', '490110', 1.000, 'NOS', 100000, 100000, 18.00, 9000, 9000, 0, 118000
      ) RETURNING id`,
      [draftInvoiceId],
    );

    await ormDb.transaction(async (tx: unknown) => {
      await finalizeDraftInvoiceInTransaction(
        tx as Parameters<typeof finalizeDraftInvoiceInTransaction>[0],
        {
          invoiceId: draftInvoiceId,
          businessId,
          actorUserId: state.userId,
          requestContext: { ip: '127.0.0.1', userAgent: 'vitest' },
        },
      );
    });

    const res = await pg.query<{
      lifecycle_status: string;
      seller_tagline_snapshot: string | null;
    }>(
      `SELECT lifecycle_status, seller_tagline_snapshot FROM invoices WHERE id = $1`,
      [draftInvoiceId],
    );

    expect(res.rows[0]?.lifecycle_status).toBe('finalized');
    expect(res.rows[0]?.seller_tagline_snapshot).toBe(INITIAL_TAGLINE);
  });

  it('2. finalizing a credit note copies invoice_tagline into seller_tagline_snapshot', async () => {
    // 1. Create and finalize an invoice
    const invId = await insertOne(
      pg,
      `INSERT INTO invoices (
        business_id, customer_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, due_date,
        place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
        total_tax_paise, grand_total_paise
      ) VALUES (
        $1, $2, $3, 'INV-TAG-002', 'draft', CURRENT_DATE, CURRENT_DATE + interval '30 days',
        '27', 50000, 4500, 4500, 0, 9000, 59000
      ) RETURNING id`,
      [businessId, customerId, fyId],
    );

    const invLineId = await insertOne(
      pg,
      `INSERT INTO invoice_line_items (
        invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
        taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise
      ) VALUES (
        $1, 'Note Books', '490110', 1.000, 'NOS', 50000, 50000, 18.00, 4500, 4500, 0, 59000
      ) RETURNING id`,
      [invId],
    );

    await ormDb.transaction(async (tx: unknown) => {
      await finalizeDraftInvoiceInTransaction(
        tx as Parameters<typeof finalizeDraftInvoiceInTransaction>[0],
        {
          invoiceId: invId,
          businessId,
          actorUserId: state.userId,
          requestContext: { ip: '127.0.0.1', userAgent: 'vitest' },
        },
      );
    });

    // 2. Create draft credit note
    const cnId = await insertOne(
      pg,
      `INSERT INTO credit_notes (
        business_id, original_invoice_id, financial_year_id, credit_note_number, lifecycle_status, status,
        reason, issue_date, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
        total_tax_paise, grand_total_paise
      ) VALUES (
        $1, $2, $3, 'CN-TAG-001', 'draft', 'active',
        'deficiency_in_service', CURRENT_DATE, 50000, 4500, 4500, 0, 9000, 59000
      ) RETURNING id`,
      [businessId, invId, fyId],
    );

    await insertOne(
      pg,
      `INSERT INTO credit_note_line_items (
        credit_note_id, original_line_item_id, description, hsn_sac_code, quantity, unit_of_measurement,
        unit_price_paise, taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise
      ) VALUES (
        $1, $2, 'Note Books Return', '490110', 1.000, 'NOS', 50000, 50000, 18.00, 4500, 4500, 0, 59000
      ) RETURNING id`,
      [cnId, invLineId],
    );

    // 3. Finalize credit note
    await ormDb.transaction(async (tx: unknown) => {
      await finalizeDraftCreditNoteInTransaction(
        tx as Parameters<typeof finalizeDraftCreditNoteInTransaction>[0],
        {
          creditNoteId: cnId,
          businessId,
          actorUserId: state.userId,
          requestContext: { ip: '127.0.0.1', userAgent: 'vitest' },
        },
      );
    });

    const cnRes = await pg.query<{
      lifecycle_status: string;
      seller_tagline_snapshot: string | null;
    }>(
      `SELECT lifecycle_status, seller_tagline_snapshot FROM credit_notes WHERE id = $1`,
      [cnId],
    );

    expect(cnRes.rows[0]?.lifecycle_status).toBe('finalized');
    expect(cnRes.rows[0]?.seller_tagline_snapshot).toBe(INITIAL_TAGLINE);
  });

  it('3. changing the business tagline leaves finalized rows with the old snapshot value', async () => {
    // 1. Finalize an invoice under INITIAL_TAGLINE
    const invId = await insertOne(
      pg,
      `INSERT INTO invoices (
        business_id, customer_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, due_date,
        place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
        total_tax_paise, grand_total_paise
      ) VALUES (
        $1, $2, $3, 'INV-TAG-003', 'draft', CURRENT_DATE, CURRENT_DATE + interval '30 days',
        '27', 10000, 900, 900, 0, 1800, 11800
      ) RETURNING id`,
      [businessId, customerId, fyId],
    );

    await insertOne(
      pg,
      `INSERT INTO invoice_line_items (
        invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
        taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise
      ) VALUES (
        $1, 'Item', '490110', 1.000, 'NOS', 10000, 10000, 18.00, 900, 900, 0, 11800
      ) RETURNING id`,
      [invId],
    );

    await ormDb.transaction(async (tx: unknown) => {
      await finalizeDraftInvoiceInTransaction(
        tx as Parameters<typeof finalizeDraftInvoiceInTransaction>[0],
        {
          invoiceId: invId,
          businessId,
          actorUserId: state.userId,
          requestContext: { ip: '127.0.0.1', userAgent: 'vitest' },
        },
      );
    });

    // 2. Change the live business tagline
    const NEW_TAGLINE = 'AUTHORISED DEALER OF ELECTRICAL GOODS & HOME APPLIANCES';
    await pg.query(`UPDATE businesses SET invoice_tagline = $1 WHERE id = $2`, [NEW_TAGLINE, businessId]);

    // 3. Verify finalized invoice still has the old snapshot value
    const invRes = await pg.query<{ seller_tagline_snapshot: string | null }>(
      `SELECT seller_tagline_snapshot FROM invoices WHERE id = $1`,
      [invId],
    );
    expect(invRes.rows[0]?.seller_tagline_snapshot).toBe(INITIAL_TAGLINE);

    // 4. Restore the tagline for following tests
    await pg.query(`UPDATE businesses SET invoice_tagline = $1 WHERE id = $2`, [INITIAL_TAGLINE, businessId]);
  });

  it('4. direct UPDATE of seller_tagline_snapshot on finalized invoice is rejected by immutability trigger (SQLSTATE 55000)', async () => {
    const draftId = await insertOne(
      pg,
      `INSERT INTO invoices (
        business_id, customer_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, due_date,
        place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
        total_tax_paise, grand_total_paise
      ) VALUES (
        $1, $2, $3, 'INV-TAG-IMM', 'draft', CURRENT_DATE, CURRENT_DATE + interval '30 days',
        '27', 10000, 900, 900, 0, 1800, 11800
      ) RETURNING id`,
      [businessId, customerId, fyId],
    );

    await insertOne(
      pg,
      `INSERT INTO invoice_line_items (
        invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
        taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise
      ) VALUES (
        $1, 'Item', '490110', 1.000, 'NOS', 10000, 10000, 18.00, 900, 900, 0, 11800
      ) RETURNING id`,
      [draftId],
    );

    await ormDb.transaction(async (tx: unknown) => {
      await finalizeDraftInvoiceInTransaction(
        tx as Parameters<typeof finalizeDraftInvoiceInTransaction>[0],
        {
          invoiceId: draftId,
          businessId,
          actorUserId: state.userId,
          requestContext: { ip: '127.0.0.1', userAgent: 'vitest' },
        },
      );
    });

    // Attempt to mutate seller_tagline_snapshot on finalized invoice must throw 55000 (BM_IMMUTABLE_RECORD)
    await expect(
      pg.query(
        `UPDATE invoices SET seller_tagline_snapshot = 'TAMPERED TAGLINE' WHERE id = $1`,
        [draftId],
      ),
    ).rejects.toThrow(/immutable|55000/i);
  });
});

