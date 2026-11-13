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
import { isSignatureKeyReferenced } from '@/lib/storage/signature';

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

describe('SPEC: Authorised signature snapshot & immutability integration (SIG-A)', () => {
  let pg: PGlite;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ormDb: any;
  let businessId: string;
  let businessIdB: string;
  let customerId: string;
  let fyId: string;

  const SIG_KEY_A = 'signatures/00000000-0000-0000-0000-000000000001/sig-owner.png';

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg, readJournal());
    ormDb = drizzle(pg, { schema });
    state.db = ormDb;

    businessId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, trade_name, gstin, pan, address_line1, city, state_code, pincode,
        signature_storage_key, subscription_plan, subscription_status
      ) VALUES (
        'Alpha Enterprise', 'Alpha Corp', '27AABCU9603R1ZM', 'AABCU9603R', '101 Street',
        'Mumbai', '27', '400001', $1, 'essentials', 'active'
      ) RETURNING id`,
      [SIG_KEY_A],
    );
    state.businessId = businessId;

    await pg.query(
      `INSERT INTO users (
        id, auth_user_id, email, business_id, role, display_name
      ) VALUES ($1, $2, $3, $4, 'owner', 'Test Owner')`,
      [state.userId, `auth_${state.userId}`, 'owner@test.dev', businessId],
    );

    businessIdB = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, trade_name, gstin, pan, address_line1, city, state_code, pincode,
        signature_storage_key, subscription_plan, subscription_status
      ) VALUES (
        'Beta Enterprise', 'Beta Corp', '29AABCU9603R1Z0', 'AABCU9603R', '202 Street',
        'Bengaluru', '29', '560001', 'signatures/biz-b/sig.png', 'essentials', 'active'
      ) RETURNING id`,
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
  }, 60_000); // applying all migrations to a fresh PGlite can exceed 10 s under full-suite load

  afterAll(async () => {
    await pg.close();
  });

  it('1. finalizing an invoice copies signature_storage_key into signature_storage_key_snapshot', async () => {
    const draftInvoiceId = await insertOne(
      pg,
      `INSERT INTO invoices (
        business_id, customer_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, due_date,
        place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
        total_tax_paise, grand_total_paise
      ) VALUES (
        $1, $2, $3, 'INV-DRAFT-001', 'draft', CURRENT_DATE, CURRENT_DATE + interval '30 days',
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
        $1, 'Service Item', '998311', 1.000, 'NOS', 100000, 100000, 18.00, 9000, 9000, 0, 118000
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
      signature_storage_key_snapshot: string | null;
    }>(
      `SELECT lifecycle_status, signature_storage_key_snapshot FROM invoices WHERE id = $1`,
      [draftInvoiceId],
    );

    expect(res.rows[0]?.lifecycle_status).toBe('finalized');
    expect(res.rows[0]?.signature_storage_key_snapshot).toBe(SIG_KEY_A);
  });

  it('2. finalizing a credit note copies signature_storage_key into signature_storage_key_snapshot', async () => {
    // 1. Create and finalize an invoice
    const invId = await insertOne(
      pg,
      `INSERT INTO invoices (
        business_id, customer_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, due_date,
        place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
        total_tax_paise, grand_total_paise
      ) VALUES (
        $1, $2, $3, 'INV-DRAFT-002', 'draft', CURRENT_DATE, CURRENT_DATE + interval '30 days',
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
        $1, 'Product B', '998311', 1.000, 'NOS', 50000, 50000, 18.00, 4500, 4500, 0, 59000
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

    // 2. Create draft credit note for this invoice
    const cnId = await insertOne(
      pg,
      `INSERT INTO credit_notes (
        business_id, original_invoice_id, financial_year_id, credit_note_number, lifecycle_status, status,
        reason, issue_date, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
        total_tax_paise, grand_total_paise
      ) VALUES (
        $1, $2, $3, 'CN-DRAFT-001', 'draft', 'active',
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
        $1, $2, 'Product B Return', '998311', 1.000, 'NOS', 50000, 50000, 18.00, 4500, 4500, 0, 59000
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
      signature_storage_key_snapshot: string | null;
    }>(
      `SELECT lifecycle_status, signature_storage_key_snapshot FROM credit_notes WHERE id = $1`,
      [cnId],
    );

    expect(cnRes.rows[0]?.lifecycle_status).toBe('finalized');
    expect(cnRes.rows[0]?.signature_storage_key_snapshot).toBe(SIG_KEY_A);
  });

  it('3. UPDATE of signature_storage_key_snapshot on finalized invoice is rejected by immutability trigger (SQLSTATE 55000)', async () => {
    const draftId = await insertOne(
      pg,
      `INSERT INTO invoices (
        business_id, customer_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, due_date,
        place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
        total_tax_paise, grand_total_paise
      ) VALUES (
        $1, $2, $3, 'INV-DRAFT-IMM', 'draft', CURRENT_DATE, CURRENT_DATE + interval '30 days',
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
        $1, 'Service Item', '998311', 1.000, 'NOS', 10000, 10000, 18.00, 900, 900, 0, 11800
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

    // Any attempt to mutate signature_storage_key_snapshot must throw 55000 (BM_IMMUTABLE_RECORD)
    await expect(
      pg.query(
        `UPDATE invoices SET signature_storage_key_snapshot = 'signatures/tampered.png' WHERE id = $1`,
        [draftId],
      ),
    ).rejects.toThrow(/immutable|55000/i);
  });

  it('4. UPDATE of signature_storage_key_snapshot on finalized credit note is rejected by immutability trigger (SQLSTATE 55000)', async () => {
    const invId = await insertOne(
      pg,
      `INSERT INTO invoices (
        business_id, customer_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, due_date,
        place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
        total_tax_paise, grand_total_paise
      ) VALUES (
        $1, $2, $3, 'INV-FOR-CN-IMM', 'draft', CURRENT_DATE, CURRENT_DATE + interval '30 days',
        '27', 20000, 1800, 1800, 0, 3600, 23600
      ) RETURNING id`,
      [businessId, customerId, fyId],
    );

    const invLineId = await insertOne(
      pg,
      `INSERT INTO invoice_line_items (
        invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
        taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise
      ) VALUES (
        $1, 'Consulting', '998311', 1.000, 'NOS', 20000, 20000, 18.00, 1800, 1800, 0, 23600
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

    const cnId = await insertOne(
      pg,
      `INSERT INTO credit_notes (
        business_id, original_invoice_id, financial_year_id, credit_note_number, lifecycle_status, status,
        reason, issue_date, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
        total_tax_paise, grand_total_paise
      ) VALUES (
        $1, $2, $3, 'CN-DRAFT-IMM', 'draft', 'active',
        'deficiency_in_service', CURRENT_DATE, 20000, 1800, 1800, 0, 3600, 23600
      ) RETURNING id`,
      [businessId, invId, fyId],
    );

    await insertOne(
      pg,
      `INSERT INTO credit_note_line_items (
        credit_note_id, original_line_item_id, description, hsn_sac_code, quantity, unit_of_measurement,
        unit_price_paise, taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise
      ) VALUES (
        $1, $2, 'Consulting Return', '998311', 1.000, 'NOS', 20000, 20000, 18.00, 1800, 1800, 0, 23600
      ) RETURNING id`,
      [cnId, invLineId],
    );

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

    await expect(
      pg.query(
        `UPDATE credit_notes SET signature_storage_key_snapshot = 'signatures/tampered.png' WHERE id = $1`,
        [cnId],
      ),
    ).rejects.toThrow(/immutable|55000/i);
  });

  it('5. isSignatureKeyReferenced: true/false cases scoped strictly by business_id', async () => {
    // SIG_KEY_A is referenced by businessId's documents
    const isRefA = await isSignatureKeyReferenced(ormDb, businessId, SIG_KEY_A);
    expect(isRefA).toBe(true);

    // An unreferenced key for businessId returns false
    const isUnref = await isSignatureKeyReferenced(
      ormDb,
      businessId,
      'signatures/00000000-0000-0000-0000-000000000001/unused.png',
    );
    expect(isUnref).toBe(false);

    // Cross-tenant scoping: Business B querying Business A's referenced key returns false
    const isCrossTenant = await isSignatureKeyReferenced(ormDb, businessIdB, SIG_KEY_A);
    expect(isCrossTenant).toBe(false);
  });
});
