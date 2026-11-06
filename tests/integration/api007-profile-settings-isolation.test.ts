import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/lib/db/schema';
import type { InvoiceSettingsGateResult } from '@/lib/subscriptions/invoice-settings-gate';

interface GateMockState {
  override?: (
    subscription: unknown,
    currentFormat: string | null,
    requested: { invoice_number_format?: string | null; default_invoice_template?: string | null },
  ) => InvoiceSettingsGateResult;
}

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: '00000000-0000-0000-0000-000000000001',
  businessId: null as string | null,
}));

const gateMock: GateMockState = vi.hoisted(() => ({
  override: undefined,
}));

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({
    id: state.userId,
    business_id: state.businessId,
    role: 'owner' as const,
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

vi.mock('@/lib/subscriptions/invoice-settings-gate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/subscriptions/invoice-settings-gate')>();
  return {
    ...actual,
    checkInvoiceSettingsEntitlement: (
      subscription: Parameters<typeof actual.checkInvoiceSettingsEntitlement>[0],
      currentFormat: Parameters<typeof actual.checkInvoiceSettingsEntitlement>[1],
      requested: Parameters<typeof actual.checkInvoiceSettingsEntitlement>[2],
    ): InvoiceSettingsGateResult => {
      if (gateMock.override) {
        return gateMock.override(subscription, currentFormat, requested);
      }
      return actual.checkInvoiceSettingsEntitlement(subscription, currentFormat, requested);
    },
  };
});

import { saveBusinessProfile } from '@/lib/actions/business/save-business-profile';
import { saveInvoiceSettings } from '@/lib/actions/invoices/save-invoice-settings';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');
const DEFAULT_INVOICE_TERMS =
  '1. Goods once sold will not be taken back.\n2. Payment to be made within 30 days from the date of invoice.\n3. Interest @ 24% per annum will be charged on overdue invoices until payment is received.';

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

interface BusinessRow {
  id: string;
  legal_name: string;
  address_line1: string;
  default_invoice_template: string;
  default_gst_rate_type: string;
  invoice_number_format: string;
  credit_note_number_prefix: string;
  payment_due_days: number;
  invoice_terms: string;
  subscription_plan: string;
  subscription_status: string;
  trial_ends_at: string | Date | null;
  subscription_ends_at: string | Date | null;
  updated_at: string | Date;
  invoice_display_prefs?: unknown;
}

interface UserRow {
  id: string;
  business_id: string | null;
}

interface FinancialYearRow {
  id: string;
  business_id: string;
  label: string;
  is_current: boolean;
  invoice_sequence_counter: number;
  credit_note_sequence_counter: number;
}

async function insertOne(pg: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const result = await pg.query<IdRow>(sqlText, params);
  const row = result.rows[0];
  if (!row) {
    throw new Error(`no row returned for: ${sqlText}`);
  }
  return row.id;
}

describe('API-007: Profile settings isolation and plan gating', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg, readJournal());
    state.db = drizzle(pg, { schema });
    await pg.query(
      `INSERT INTO users (id, auth_user_id, email, display_name, role)
       VALUES ('00000000-0000-0000-0000-000000000001', 'auth_user_001', 'test@test.dev', 'Test User', 'owner')`,
    );
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  afterEach(async () => {
    gateMock.override = undefined;
    state.businessId = null;
    await pg.query('UPDATE users SET business_id = NULL WHERE id = $1', [state.userId]);
  });

  it('1. Paid regression: saveBusinessProfile on paid business preserves all six invoice settings and updates profile', async () => {
    const paidBizId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        default_invoice_template, default_gst_rate_type, invoice_terms, payment_due_days,
        invoice_number_format, credit_note_number_prefix, subscription_plan, subscription_status,
        subscription_ends_at, updated_at, invoice_display_prefs
      ) VALUES (
        'Paid Biz Corp', '29ABCDE1234F1Z5', '100 Old Road', 'Bengaluru', '29', '560001',
        'template_2', 'inclusive', 'T', 45,
        'CUSTOM/{FY}/{SEQ:4}', 'XX', 'essentials', 'active',
        now() + interval '30 days', '2026-01-01 00:00:00+00', '{"showHsn":false,"fixedRowsCount":20}'::jsonb
      ) RETURNING id`,
    );

    const initialResult = await pg.query<BusinessRow>('SELECT * FROM businesses WHERE id = $1', [paidBizId]);
    const initialRow = initialResult.rows[0];
    if (!initialRow) throw new Error('Initial row not found');
    const initialUpdatedAt = new Date(initialRow.updated_at).getTime();

    state.businessId = paidBizId;
    await pg.query('UPDATE users SET business_id = $1 WHERE id = $2', [paidBizId, state.userId]);

    const res = await saveBusinessProfile({
      legal_name: 'Paid Biz Corp',
      trade_name: 'Paid Biz',
      gstin: '29ABCDE1234F1Z5',
      registration_type: 'regular',
      address_line1: '200 New Road',
      city: 'Bengaluru',
      state_code: '29',
      pincode: '560001',
    });

    expect(res.success).toBe(true);

    const updatedResult = await pg.query<BusinessRow>('SELECT * FROM businesses WHERE id = $1', [paidBizId]);
    const updatedRow = updatedResult.rows[0];
    if (!updatedRow) throw new Error('Updated row not found');

    expect(updatedRow.address_line1).toBe('200 New Road');
    expect(new Date(updatedRow.updated_at).getTime()).toBeGreaterThan(initialUpdatedAt);
    expect(updatedRow.default_invoice_template).toBe('template_2');
    expect(updatedRow.default_gst_rate_type).toBe('inclusive');
    expect(updatedRow.invoice_terms).toBe('T');
    expect(updatedRow.payment_due_days).toBe(45);
    expect(updatedRow.invoice_number_format).toBe('CUSTOM/{FY}/{SEQ:4}');
    expect(updatedRow.credit_note_number_prefix).toBe('XX');
    expect(updatedRow.invoice_display_prefs).toEqual({ showHsn: false, fixedRowsCount: 20 });
  });

  it('2. Legacy/stale payload ignored: stale invoice-settings keys in profile edit payload do not overwrite settings', async () => {
    const paidBizId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        default_invoice_template, default_gst_rate_type, invoice_terms, payment_due_days,
        invoice_number_format, credit_note_number_prefix, subscription_plan, subscription_status,
        subscription_ends_at, updated_at
      ) VALUES (
        'Stale Test Corp', '29ABCDE1234F2Z5', '100 Old Road', 'Bengaluru', '29', '560001',
        'template_2', 'inclusive', 'T', 45,
        'CUSTOM/{FY}/{SEQ:4}', 'XX', 'essentials', 'active',
        now() + interval '30 days', '2026-01-01 00:00:00+00'
      ) RETURNING id`,
    );

    state.businessId = paidBizId;
    await pg.query('UPDATE users SET business_id = $1 WHERE id = $2', [paidBizId, state.userId]);

    const res = await saveBusinessProfile({
      legal_name: 'Stale Test Corp',
      trade_name: 'Stale Test',
      gstin: '29ABCDE1234F2Z5',
      registration_type: 'regular',
      address_line1: '300 Newer Road',
      city: 'Bengaluru',
      state_code: '29',
      pincode: '560001',
      default_invoice_template: 'template_1',
      default_gst_rate_type: 'exclusive',
      invoice_terms: 'X',
      payment_due_days: 1,
      invoice_number_format: 'ZZ/{SEQ:3}',
      credit_note_number_prefix: 'ZZ',
    });

    expect(res.success).toBe(true);

    const updatedResult = await pg.query<BusinessRow>('SELECT * FROM businesses WHERE id = $1', [paidBizId]);
    const updatedRow = updatedResult.rows[0];
    if (!updatedRow) throw new Error('Updated row not found');

    expect(updatedRow.address_line1).toBe('300 Newer Road');
    expect(updatedRow.default_invoice_template).toBe('template_2');
    expect(updatedRow.default_gst_rate_type).toBe('inclusive');
    expect(updatedRow.invoice_terms).toBe('T');
    expect(updatedRow.payment_due_days).toBe(45);
    expect(updatedRow.invoice_number_format).toBe('CUSTOM/{FY}/{SEQ:4}');
    expect(updatedRow.credit_note_number_prefix).toBe('XX');
  });

  it('3. Free bypass closed: free business supplying template_3 via profile edit has it ignored', async () => {
    const freeBizId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        default_invoice_template, default_gst_rate_type, invoice_terms, payment_due_days,
        invoice_number_format, credit_note_number_prefix, subscription_plan, subscription_status,
        trial_ends_at
      ) VALUES (
        'Free Biz Corp', '29AAAAA0000A1Z5', '500 Free Way', 'Bengaluru', '29', '560001',
        'template_1', 'exclusive', 'Free terms', 30,
        'BMA/{FY}/{SEQ:4}', 'CN', 'trial', 'trial',
        now() - interval '1 day'
      ) RETURNING id`,
    );

    state.businessId = freeBizId;
    await pg.query('UPDATE users SET business_id = $1 WHERE id = $2', [freeBizId, state.userId]);

    const res = await saveBusinessProfile({
      legal_name: 'Free Biz Corp',
      trade_name: 'Free Biz',
      gstin: '29AAAAA0000A1Z5',
      registration_type: 'regular',
      address_line1: '501 Updated Free Way',
      city: 'Bengaluru',
      state_code: '29',
      pincode: '560001',
      default_invoice_template: 'template_3',
    });

    expect(res.success).toBe(true);

    const rowResult = await pg.query<BusinessRow>('SELECT * FROM businesses WHERE id = $1', [freeBizId]);
    const row = rowResult.rows[0];
    if (!row) throw new Error('Free row not found');

    expect(row.address_line1).toBe('501 Updated Free Way');
    expect(row.default_invoice_template).toBe('template_1');
    expect(row.default_gst_rate_type).toBe('exclusive');
  });

  it('4. Parity: saveInvoiceSettings enforces identical error codes and messages', async () => {
    const freeBizId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        default_invoice_template, default_gst_rate_type, invoice_terms, payment_due_days,
        invoice_number_format, credit_note_number_prefix, subscription_plan, subscription_status,
        trial_ends_at
      ) VALUES (
        'Free Parity Biz', '29BBBBB0000B1Z5', '600 Parity Way', 'Bengaluru', '29', '560001',
        'template_1', 'exclusive', 'Free terms', 30,
        'BMA/{FY}/{SEQ:4}', 'CN', 'trial', 'trial',
        now() - interval '1 day'
      ) RETURNING id`,
    );

    state.businessId = freeBizId;
    await pg.query('UPDATE users SET business_id = $1 WHERE id = $2', [freeBizId, state.userId]);

    const templateResult = await saveInvoiceSettings({
      invoice_number_format: 'BMA/{FY}/{SEQ:4}',
      credit_note_number_prefix: 'CN',
      payment_due_days: 30,
      default_invoice_template: 'template_3',
      default_gst_rate_type: 'exclusive',
      invoice_terms: 'Free terms',
    });

    expect(templateResult.success).toBe(false);
    if (!templateResult.success) {
      expect(templateResult.error.code).toBe('TEMPLATE_LOCKED');
      expect(templateResult.error.message).toBe(
        'Traditional, Carbon Pad, and Book Depot templates are exclusive to Essentials Pro. Upgrade to unlock all 4 premium templates.',
      );
    }

    const formatResult = await saveInvoiceSettings({
      invoice_number_format: 'XYZ/{SEQ:4}',
      credit_note_number_prefix: 'CN',
      payment_due_days: 30,
      default_invoice_template: 'template_1',
      default_gst_rate_type: 'exclusive',
      invoice_terms: 'Free terms',
    });

    expect(formatResult.success).toBe(false);
    if (!formatResult.success) {
      expect(formatResult.error.code).toBe('INVOICE_FORMAT_LOCKED');
      expect(formatResult.error.message).toBe(
        'Custom invoice numbering formats and brand prefixes are exclusive to paid plans. Upgrade to Essentials Pro to customize your invoice format.',
      );
    }

    const paidBizId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        default_invoice_template, default_gst_rate_type, invoice_terms, payment_due_days,
        invoice_number_format, credit_note_number_prefix, subscription_plan, subscription_status,
        subscription_ends_at
      ) VALUES (
        'Paid Parity Biz', '29CCCCC0000C1Z5', '700 Parity Road', 'Bengaluru', '29', '560001',
        'template_1', 'exclusive', 'Terms', 30,
        'BMA/{FY}/{SEQ:4}', 'CN', 'essentials', 'active',
        now() + interval '30 days'
      ) RETURNING id`,
    );

    state.businessId = paidBizId;
    await pg.query('UPDATE users SET business_id = $1 WHERE id = $2', [paidBizId, state.userId]);

    const paidSaveResult = await saveInvoiceSettings({
      invoice_number_format: 'PAID/{FY}/{SEQ:4}',
      credit_note_number_prefix: 'PCN',
      payment_due_days: 15,
      default_invoice_template: 'template_2',
      default_gst_rate_type: 'inclusive',
      invoice_terms: 'Paid terms',
    });

    expect(paidSaveResult.success).toBe(true);

    const paidRowResult = await pg.query<BusinessRow>('SELECT * FROM businesses WHERE id = $1', [paidBizId]);
    const paidRow = paidRowResult.rows[0];
    if (!paidRow) throw new Error('Paid row not found');

    expect(paidRow.default_invoice_template).toBe('template_2');
    expect(paidRow.invoice_number_format).toBe('PAID/{FY}/{SEQ:4}');
    expect(paidRow.credit_note_number_prefix).toBe('PCN');
    expect(paidRow.payment_due_days).toBe(15);
    expect(paidRow.default_gst_rate_type).toBe('inclusive');
  });

  it('5. First-time setup defaults: caller with business_id = null gets full defaults, FY row, and user link; active trial may use template_3', async () => {
    const user5Id = '00000000-0000-0000-0000-000000000005';
    await pg.query(
      `INSERT INTO users (id, auth_user_id, email, business_id) VALUES ($1, 'auth_user_5', 'user5@test.com', NULL)`,
      [user5Id],
    );

    state.userId = user5Id;
    state.businessId = null;

    const res1 = await saveBusinessProfile({
      legal_name: 'Brand New Startup 1',
      gstin: '29DDDDD1111D1Z5',
      registration_type: 'regular',
      address_line1: '1 Startup Lane',
      city: 'Bengaluru',
      state_code: '29',
      pincode: '560001',
    });

    expect(res1.success).toBe(true);
    if (!res1.success) return;

    const newBizId1 = res1.data.businessId;

    const bizResult1 = await pg.query<BusinessRow>('SELECT * FROM businesses WHERE id = $1', [newBizId1]);
    const bizRow1 = bizResult1.rows[0];
    if (!bizRow1) throw new Error('Business 1 not found');

    expect(bizRow1.default_invoice_template).toBe('template_1');
    expect(bizRow1.default_gst_rate_type).toBe('exclusive');
    expect(bizRow1.invoice_number_format).toBe('BMA/{FY}/{SEQ:4}');
    expect(bizRow1.credit_note_number_prefix).toBe('CN');
    expect(bizRow1.payment_due_days).toBe(30);
    expect(bizRow1.invoice_terms).toBe(DEFAULT_INVOICE_TERMS);
    expect(bizRow1.subscription_plan).toBe('trial');
    expect(bizRow1.subscription_status).toBe('trial');

    const expectedTrialEnd = Date.now() + 14 * 24 * 60 * 60 * 1000;
    const actualTrialEnd = new Date(bizRow1.trial_ends_at ?? 0).getTime();
    expect(Math.abs(actualTrialEnd - expectedTrialEnd)).toBeLessThan(60000);

    const fyResult1 = await pg.query<FinancialYearRow>('SELECT * FROM financial_years WHERE business_id = $1', [
      newBizId1,
    ]);
    expect(fyResult1.rows.length).toBe(1);
    const fyRow1 = fyResult1.rows[0];
    if (!fyRow1) throw new Error('FY row not found');
    expect(fyRow1.is_current).toBe(true);
    expect(fyRow1.invoice_sequence_counter).toBe(0);
    expect(fyRow1.credit_note_sequence_counter).toBe(0);

    const userResult1 = await pg.query<UserRow>('SELECT * FROM users WHERE id = $1', [user5Id]);
    const userRow1 = userResult1.rows[0];
    if (!userRow1) throw new Error('User row 1 not found');
    expect(userRow1.business_id).toBe(newBizId1);

    const user6Id = '00000000-0000-0000-0000-000000000006';
    await pg.query(
      `INSERT INTO users (id, auth_user_id, email, business_id) VALUES ($1, 'auth_user_6', 'user6@test.com', NULL)`,
      [user6Id],
    );

    state.userId = user6Id;
    state.businessId = null;

    const res2 = await saveBusinessProfile({
      legal_name: 'Brand New Startup 2',
      gstin: '29EEEEE2222E1Z5',
      registration_type: 'regular',
      address_line1: '2 Startup Lane',
      city: 'Bengaluru',
      state_code: '29',
      pincode: '560001',
      default_invoice_template: 'template_3',
    });

    expect(res2.success).toBe(true);
    if (!res2.success) return;

    const newBizId2 = res2.data.businessId;
    const bizResult2 = await pg.query<BusinessRow>('SELECT * FROM businesses WHERE id = $1', [newBizId2]);
    const bizRow2 = bizResult2.rows[0];
    if (!bizRow2) throw new Error('Business 2 not found');

    expect(bizRow2.default_invoice_template).toBe('template_3');
  });

  it('6. Gate failure on first-time setup is atomic and typed: returns gate code/message, rolls back transaction cleanly', async () => {
    const user7Id = '00000000-0000-0000-0000-000000000007';
    await pg.query(
      `INSERT INTO users (id, auth_user_id, email, business_id) VALUES ($1, 'auth_user_7', 'user7@test.com', NULL)`,
      [user7Id],
    );

    state.userId = user7Id;
    state.businessId = null;

    gateMock.override = () => ({
      allowed: false,
      code: 'TEMPLATE_LOCKED',
      message: 'M',
    });

    const targetGstin = '29FFFFF3333F1Z5';
    const res = await saveBusinessProfile({
      legal_name: 'Failing Startup',
      gstin: targetGstin,
      registration_type: 'regular',
      address_line1: '3 Startup Lane',
      city: 'Bengaluru',
      state_code: '29',
      pincode: '560001',
    });

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe('TEMPLATE_LOCKED');
      expect(res.error.message).toBe('M');
    }

    const bizCheck = await pg.query<BusinessRow>('SELECT * FROM businesses WHERE gstin = $1', [targetGstin]);
    expect(bizCheck.rows.length).toBe(0);

    const userCheck = await pg.query<UserRow>('SELECT * FROM users WHERE id = $1', [user7Id]);
    const userRow = userCheck.rows[0];
    if (!userRow) throw new Error('User row 7 not found');
    expect(userRow.business_id).toBeNull();
  });
});

