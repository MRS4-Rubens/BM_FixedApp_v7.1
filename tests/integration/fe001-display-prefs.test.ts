import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import { DEFAULT_INVOICE_DISPLAY_PREFS } from '@/lib/invoices/display-prefs';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: '00000000-0000-4000-8000-000000000001',
  businessId: null as string | null,
  role: 'owner' as 'owner' | 'staff',
  displayName: 'Test User' as string | null,
  email: 'test@example.com' as string | null,
  isPlatformAdmin: false,
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
    email: state.email,
    business_id: state.businessId,
    role: state.role,
    display_name: state.displayName,
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

import { finalizeDraftInvoiceInTransaction } from '@/lib/invoices/finalize-invoice-tx';
import { importLegacyDisplayPrefs } from '@/lib/actions/invoices/import-legacy-display-prefs';
import { saveInvoiceSettings } from '@/lib/actions/invoices/save-invoice-settings';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

interface JournalEntry {
  readonly tag: string;
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

async function applyMigrations(pg: PGlite, entries: readonly JournalEntry[]): Promise<void> {
  for (const entry of entries) {
    const fileContent = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8');
    const statements = fileContent
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await pg.exec(statement);
    }
  }
}

describe('FE-001: Invoice display preferences account persistence and immutability', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg, readJournal());
    const ormDb = drizzle(pg, { schema });
    state.db = ormDb;
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    state.businessId = null;
    state.role = 'owner';
    state.isPlatformAdmin = false;
  });

  it('1. businesses.invoice_display_prefs defaults to {} and enforces object check constraint', async () => {
    const bizRes = await pg.query<{ id: string; invoice_display_prefs: unknown }>(
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status
      ) VALUES (
        'Prefs Test Corp', '27AABCU9603R1ZM', '123 Test Rd', 'Mumbai', '27', '400001',
        'essentials', 'active'
      ) RETURNING id, invoice_display_prefs`,
    );

    expect(bizRes.rows.length).toBe(1);
    expect(bizRes.rows[0].invoice_display_prefs).toEqual({});

    // Reject non-object JSON values via businesses_invoice_display_prefs_object check constraint
    await expect(
      pg.query(
        `UPDATE businesses SET invoice_display_prefs = '[]'::jsonb WHERE id = $1`,
        [bizRes.rows[0].id],
      ),
    ).rejects.toThrow();

    await expect(
      pg.query(
        `UPDATE businesses SET invoice_display_prefs = '123'::jsonb WHERE id = $1`,
        [bizRes.rows[0].id],
      ),
    ).rejects.toThrow();
  });

  it('2. invoices.display_prefs_snapshot defaults to null and enforces object check constraint', async () => {
    const bizRes = await pg.query<{ id: string }>(
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status
      ) VALUES (
        'Snapshot Test Corp', '27AABCU9603R1ZN', '124 Test Rd', 'Mumbai', '27', '400001',
        'essentials', 'active'
      ) RETURNING id`,
    );
    const bizId = bizRes.rows[0].id;

    const fyRes = await pg.query<{ id: string }>(
      `INSERT INTO financial_years (
        business_id, label, start_date, end_date, is_current
      ) VALUES (
        $1, '2026-27', '2026-04-01', '2027-03-31', true
      ) RETURNING id`,
      [bizId],
    );
    const fyId = fyRes.rows[0].id;

    const invRes = await pg.query<{ id: string; display_prefs_snapshot: unknown }>(
      `INSERT INTO invoices (
        business_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, due_date,
        subtotal_paise, total_tax_paise, grand_total_paise
      ) VALUES (
        $1, $2, 'INV-DRAFT-001', 'draft', CURRENT_DATE, CURRENT_DATE + interval '30 days',
        10000, 1800, 11800
      ) RETURNING id, display_prefs_snapshot`,
      [bizId, fyId],
    );

    expect(invRes.rows.length).toBe(1);
    expect(invRes.rows[0].display_prefs_snapshot).toBeNull();

    // Reject non-object non-null JSON values
    await expect(
      pg.query(
        `UPDATE invoices SET display_prefs_snapshot = '[]'::jsonb WHERE id = $1`,
        [invRes.rows[0].id],
      ),
    ).rejects.toThrow();
  });

  it('3. finalizeDraftInvoiceInTransaction snapshots business display preferences into display_prefs_snapshot', async () => {
    const customPrefs = {
      ...DEFAULT_INVOICE_DISPLAY_PREFS,
      showHsn: false,
      discEnabled: false,
      fixedRowsCount: 22,
    };

    const bizRes = await pg.query<{ id: string }>(
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status, invoice_display_prefs
      ) VALUES (
        'Finalize Biz Corp', '27AABCU9603R1ZO', '125 Test Rd', 'Mumbai', '27', '400001',
        'essentials', 'active', $1::jsonb
      ) RETURNING id`,
      [JSON.stringify(customPrefs)],
    );
    const bizId = bizRes.rows[0].id;

    // Create user
    const userRes = await pg.query<{ id: string }>(
      `INSERT INTO users (
        id, auth_user_id, email, business_id, role, display_name
      ) VALUES (
        '00000000-0000-4000-8000-000000000002', 'auth_002', 'owner@finalize.test', $1, 'owner', 'Owner'
      ) RETURNING id`,
      [bizId],
    );
    const userId = userRes.rows[0].id;

    // Create financial year
    const fyRes = await pg.query<{ id: string }>(
      `INSERT INTO financial_years (
        business_id, label, start_date, end_date, is_current
      ) VALUES (
        $1, '2026-27', '2026-04-01', '2027-03-31', true
      ) RETURNING id`,
      [bizId],
    );
    const fyId = fyRes.rows[0].id;

    // Create draft invoice with line item
    const draftRes = await pg.query<{ id: string }>(
      `INSERT INTO invoices (
        business_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, due_date,
        place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, total_tax_paise, grand_total_paise
      ) VALUES (
        $1, $2, 'INV-DRAFT-002', 'draft', CURRENT_DATE, CURRENT_DATE + interval '30 days',
        '27', 10000, 900, 900, 0, 1800, 11800
      ) RETURNING id`,
      [bizId, fyId],
    );
    const draftId = draftRes.rows[0].id;

    await pg.query(
      `INSERT INTO invoice_line_items (
        invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
        taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise
      ) VALUES (
        $1, 'Test Service', '998311', 1.000, 'NOS', 10000, 10000, 18.00, 900, 900, 0, 11800
      )`,
      [draftId],
    );

    // Finalize invoice via transaction
    const ormDb = drizzle(pg, { schema });
    await ormDb.transaction(async (tx) => {
      await finalizeDraftInvoiceInTransaction(tx as unknown as Parameters<typeof finalizeDraftInvoiceInTransaction>[0], {
        invoiceId: draftId,
        businessId: bizId,
        actorUserId: userId,
        requestContext: { ip: '127.0.0.1', userAgent: 'vitest' },
      });
    });

    // Verify snapshot in database
    const finalizedRes = await pg.query<{
      lifecycle_status: string;
      display_prefs_snapshot: unknown;
    }>(
      `SELECT lifecycle_status, display_prefs_snapshot FROM invoices WHERE id = $1`,
      [draftId],
    );

    expect(finalizedRes.rows[0].lifecycle_status).toBe('finalized');
    expect(finalizedRes.rows[0].display_prefs_snapshot).toEqual(customPrefs);
  });

  it('4. bm_guard_invoices trigger blocks updating display_prefs_snapshot on finalized invoice', async () => {
    const bizRes = await pg.query<{ id: string }>(
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status
      ) VALUES (
        'Immutable Test Corp', '27AABCU9603R1ZP', '126 Test Rd', 'Mumbai', '27', '400001',
        'essentials', 'active'
      ) RETURNING id`,
    );
    const bizId = bizRes.rows[0].id;

    const userRes = await pg.query<{ id: string }>(
      `INSERT INTO users (
        id, auth_user_id, email, business_id, role, display_name
      ) VALUES (
        '00000000-0000-4000-8000-000000000099', 'auth_099', 'owner@immutable.test', $1, 'owner', 'Owner'
      ) RETURNING id`,
      [bizId],
    );
    const userId = userRes.rows[0].id;

    const fyRes = await pg.query<{ id: string }>(
      `INSERT INTO financial_years (
        business_id, label, start_date, end_date, is_current
      ) VALUES (
        $1, '2026-27', '2026-04-01', '2027-03-31', true
      ) RETURNING id`,
      [bizId],
    );
    const fyId = fyRes.rows[0].id;

    const draftRes = await pg.query<{ id: string }>(
      `INSERT INTO invoices (
        business_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, due_date,
        place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, total_tax_paise, grand_total_paise
      ) VALUES (
        $1, $2, 'INV-DRAFT-999', 'draft', CURRENT_DATE, CURRENT_DATE + interval '30 days',
        '27', 10000, 900, 900, 0, 1800, 11800
      ) RETURNING id`,
      [bizId, fyId],
    );
    const invId = draftRes.rows[0].id;

    await pg.query(
      `INSERT INTO invoice_line_items (
        invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
        taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise
      ) VALUES (
        $1, 'Immutable Service', '998311', 1.000, 'NOS', 10000, 10000, 18.00, 900, 900, 0, 11800
      )`,
      [invId],
    );

    const ormDb = drizzle(pg, { schema });
    await ormDb.transaction(async (tx) => {
      await finalizeDraftInvoiceInTransaction(tx as unknown as Parameters<typeof finalizeDraftInvoiceInTransaction>[0], {
        invoiceId: invId,
        businessId: bizId,
        actorUserId: userId,
        requestContext: { ip: '127.0.0.1', userAgent: 'vitest' },
      });
    });

    // Direct attempt to update display_prefs_snapshot must fail via bm_guard_invoices
    await expect(
      pg.query(
        `UPDATE invoices SET display_prefs_snapshot = '{"showHsn":false}'::jsonb WHERE id = $1`,
        [invId],
      ),
    ).rejects.toThrow(/immutable|55000/i);
  });

  it('5. migration 0026_fe001_invoice_display_prefs is strictly idempotent when re-run', async () => {
    const migrationSql = readFileSync(
      join(DRIZZLE_DIR, '0026_fe001_invoice_display_prefs.sql'),
      'utf8',
    );
    const statements = migrationSql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Running second time should not fail
    for (const statement of statements) {
      await expect(pg.exec(statement)).resolves.not.toThrow();
    }
  });

  it('6. importLegacyDisplayPrefs updates businesses.invoice_display_prefs for authenticated owner', async () => {
    const bizRes = await pg.query<{ id: string }>(
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status
      ) VALUES (
        'Import Action Corp', '27AABCU9603R1ZQ', '127 Test Rd', 'Mumbai', '27', '400001',
        'essentials', 'active'
      ) RETURNING id`,
    );
    const bizId = bizRes.rows[0].id;

    await pg.query(
      `INSERT INTO users (
        id, auth_user_id, email, business_id, role, display_name
      ) VALUES (
        '00000000-0000-4000-8000-000000000003', 'auth_003', 'owner@import.test', $1, 'owner', 'Owner'
      )`,
      [bizId],
    );

    state.userId = '00000000-0000-4000-8000-000000000003';
    state.businessId = bizId;
    state.role = 'owner';

    const newPrefs = {
      ...DEFAULT_INVOICE_DISPLAY_PREFS,
      showHsn: false,
      fixedRowsCount: 30,
    };

    const res = await importLegacyDisplayPrefs({ display_prefs: newPrefs });
    if (!res.success) console.error("IMPORT ERROR:", res.error);
    expect(res.success).toBe(true);

    const checkRes = await pg.query<{ invoice_display_prefs: unknown }>(
      `SELECT invoice_display_prefs FROM businesses WHERE id = $1`,
      [bizId],
    );
    expect(checkRes.rows[0].invoice_display_prefs).toEqual(newPrefs);
  });

  it('7. saveInvoiceSettings updates businesses.invoice_display_prefs alongside other settings', async () => {
    const bizRes = await pg.query<{ id: string }>(
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status
      ) VALUES (
        'Save Settings Corp', '27AABCU9603R1ZR', '128 Test Rd', 'Mumbai', '27', '400001',
        'essentials', 'active'
      ) RETURNING id`,
    );
    const bizId = bizRes.rows[0].id;

    await pg.query(
      `INSERT INTO users (
        id, auth_user_id, email, business_id, role, display_name
      ) VALUES (
        '00000000-0000-4000-8000-000000000004', 'auth_004', 'owner@save.test', $1, 'owner', 'Owner'
      )`,
      [bizId],
    );

    state.userId = '00000000-0000-4000-8000-000000000004';
    state.businessId = bizId;
    state.role = 'owner';

    const newPrefs = {
      ...DEFAULT_INVOICE_DISPLAY_PREFS,
      discEnabled: false,
      defaultGst: '12' as const,
    };

    const res = await saveInvoiceSettings({
      invoice_number_format: 'INV/{FY}/{SEQ:4}',
      credit_note_number_prefix: 'CN',
      payment_due_days: 15,
      default_invoice_template: 'template_1',
      default_gst_rate_type: 'exclusive',
      invoice_terms: 'Strict terms',
      display_prefs: newPrefs,
    });

    expect(res.success).toBe(true);

    const checkRes = await pg.query<{
      payment_due_days: number;
      invoice_display_prefs: unknown;
    }>(
      `SELECT payment_due_days, invoice_display_prefs FROM businesses WHERE id = $1`,
      [bizId],
    );
    expect(checkRes.rows[0].payment_due_days).toBe(15);
    expect(checkRes.rows[0].invoice_display_prefs).toEqual(newPrefs);
  });
});
