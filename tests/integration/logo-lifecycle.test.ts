import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import type { ActionResult } from '@/lib/actions/_shared/types';
import { formatIstDateAsIso } from '@/lib/invoices/ist-date';
import { getIndianFinancialYearForDate } from '@/lib/invoices/financial-year';

interface StatePg {
  query<T = unknown>(queryText: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  pg: undefined as StatePg | undefined,
  businessId: '',
  events: [] as string[],
  keyAtDelete: null as string | null,
  failUpload: false,
  failAudit: false,
}));

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({
    id: '00000000-0000-4000-8000-000000000001',
    auth_user_id: 'auth_00000000-0000-4000-8000-000000000001',
    email: 'owner@acme.dev',
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
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/storage/archive-invoice', () => ({ archiveInvoicePdf: async () => ({ success: true }) }));
vi.mock('@/lib/storage/archive-credit-note', () => ({ archiveCreditNotePdf: async () => ({ success: true }) }));
vi.mock('@/lib/storage/schedule-archival', () => ({ scheduleArchival: vi.fn() }));
vi.mock('@/lib/env', () => ({
  getAppEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://test.app' }),
  getEmailEnv: () => ({ RESEND_FROM_EMAIL: 'noreply@test.app' }),
  getAdminEnv: () => ({
    PLATFORM_ADMIN_EMAILS: ['admin@test.dev'],
    PLATFORM_ADMIN_USER_IDS: ['a0000000-0000-4000-8000-000000000099'],
  }),
}));

vi.mock('@/lib/storage/idrive', () => ({
  uploadFileToStorage: vi.fn(async (key: string) => {
    if (state.failUpload) {
      throw new Error('simulated storage upload failure');
    }
    state.events.push(`upload:${key}`);
    return undefined;
  }),
  deleteFileFromStorage: vi.fn(async (key: string) => {
    state.events.push(`delete:${key}`);
    if (state.pg && state.businessId) {
      const res = await state.pg.query<{ logo_storage_key: string | null }>(
        'SELECT logo_storage_key FROM businesses WHERE id = $1',
        [state.businessId],
      );
      state.keyAtDelete = res.rows[0]?.logo_storage_key ?? null;
    }
    return undefined;
  }),
  getFileBuffer: vi.fn(async () => Buffer.from('fake-image-bytes')),
  getSignedDownloadUrl: vi.fn(async () => 'https://mock-storage.test/download'),
}));

vi.mock('@/lib/audit/log', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit/log')>('@/lib/audit/log');
  return {
    ...actual,
    writeAudit: vi.fn(async (...args: Parameters<typeof actual.writeAudit>) => {
      if (state.failAudit) {
        throw new Error('simulated audit failure');
      }
      return actual.writeAudit(...args);
    }),
  };
});

import { uploadBusinessLogo } from '@/lib/actions/business/upload-logo';
import { removeBusinessLogo } from '@/lib/actions/business/remove-logo';
import { saveInvoiceDraft } from '@/lib/actions/invoices/save-invoice-draft';
import { finalizeInvoice } from '@/lib/actions/invoices/finalize-invoice';

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

const VALID_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('logo-lifecycle integration suite', () => {
  let pg: PGlite;
  let businessId: string;
  let customerId: string;
  let taxRateId: string;
  let productId: string;

  beforeAll(async () => {
    pg = new PGlite();
    state.pg = pg;
    state.db = drizzle(pg, { schema });

    const journal = readJournal();
    await applyMigrations(pg, journal);

    businessId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, trade_name, gstin, pan, address_line1, address_line2, city, state_code, pincode,
        phone, email, nature_of_business, logo_storage_key, bank_account_name, bank_account_number, bank_ifsc,
        bank_name, invoice_terms, subscription_plan, subscription_status, subscription_ends_at
      ) VALUES (
        'Acme Invoicing Pvt Ltd', 'Acme Brand', '29ABCDE1234F1Z5', 'ABCDE1234F', '123 Tech Park', 'Fl 1',
        'Bengaluru', '29', '560001', '+919876543210', 'billing@acme.dev', 'Services',
        'logos/placeholder.png', 'Acme Operating', '1234567890', 'ICIC0001234', 'ICICI Bank',
        'Net 30', 'professional', 'active', now() + interval '30 days'
      ) RETURNING id`,
    );
    state.businessId = businessId;

    await pg.query(
      `INSERT INTO users (id, auth_user_id, business_id, email, display_name, role)
       VALUES ('00000000-0000-4000-8000-000000000001', 'auth_001', $1, 'owner@acme.dev', 'Test Owner', 'owner')`,
      [businessId],
    );

    const { label, startDate, endDate } = getIndianFinancialYearForDate(new Date());
    await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, $3, $4, true) RETURNING id`,
      [businessId, label, formatIstDateAsIso(startDate), formatIstDateAsIso(endDate)],
    );

    customerId = await insertOne(
      pg,
      `INSERT INTO customers (business_id, name, email, state_code)
       VALUES ($1, 'Acme Buyer', 'buyer@acme.dev', '29') RETURNING id`,
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
       VALUES ($1, 'Software Services', '998315', 100000) RETURNING id`,
      [businessId],
    );
  }, 120_000);

  afterAll(async () => {
    if (pg) {
      await pg.close();
    }
  });

  beforeEach(() => {
    state.events = [];
    state.keyAtDelete = null;
    state.failUpload = false;
    state.failAudit = false;
  });

  async function createFinalizedInvoice(logoKey: string): Promise<string> {
    await pg.query('UPDATE businesses SET logo_storage_key = $1 WHERE id = $2', [logoKey, businessId]);

    const draftRes = await saveInvoiceDraft({
      customer_id: customerId,
      billing_name: 'Acme Buyer',
      place_of_supply_state_code: '29',
      invoice_date: formatIstDateAsIso(new Date()),
      gst_rate_type: 'exclusive',
      line_items: [
        {
          product_id: productId,
          description: 'Software Services',
          hsn_sac_code: '998315',
          quantity: 1,
          unit_of_measurement: 'NOS',
          unit_price: 1000,
          discount: 0,
          tax_rate_id: taxRateId,
        },
      ],
    });
    const draft = expectSuccess(draftRes);

    const finRes = await finalizeInvoice({ id: draft.invoiceId });
    expectSuccess(finRes);

    const snap = await pg.query<{ logo_storage_key_snapshot: string | null }>(
      'SELECT logo_storage_key_snapshot FROM invoices WHERE id = $1',
      [draft.invoiceId],
    );
    expect(snap.rows[0]?.logo_storage_key_snapshot).toBe(logoKey);

    return draft.invoiceId;
  }

  it('STEP-0: upload keeps the previous logo when a finalized invoice snapshot references it', async () => {
    const previousKey = `logos/${businessId}/ref-logo-test1.png`;
    await createFinalizedInvoice(previousKey);

    state.events = [];
    state.keyAtDelete = null;

    const res = await uploadBusinessLogo({
      base64Data: VALID_PNG_BASE64,
    });
    const data = expectSuccess(res);

    const bizRes = await pg.query<{ logo_storage_key: string | null }>(
      'SELECT logo_storage_key FROM businesses WHERE id = $1',
      [businessId],
    );
    const dbKey = bizRes.rows[0]?.logo_storage_key;
    expect(dbKey).toBe(data.storageKey);
    expect(dbKey).toMatch(new RegExp(`^logos/${businessId}/[a-f0-9-]+\\.png$`));

    expect(state.events.includes(`delete:${previousKey}`)).toBe(false);

    const auditRes = await pg.query<{ metadata: unknown }>(
      `SELECT metadata FROM audit_log WHERE business_id = $1 AND action = 'logo_upload' ORDER BY created_at DESC LIMIT 1`,
      [businessId],
    );
    const meta = auditRes.rows[0]?.metadata;
    if (!isRecord(meta)) {
      throw new Error('Audit metadata is not a record');
    }
    expect(meta.previous_logo_storage_key).toBe(previousKey);
    expect(meta.logo_storage_key).toBe(data.storageKey);
  });

  it('STEP-0: upload deletes the previous logo when no document references it', async () => {
    const previousKey = `logos/${businessId}/unref-logo-test2.png`;
    await pg.query('UPDATE businesses SET logo_storage_key = $1 WHERE id = $2', [previousKey, businessId]);

    state.events = [];
    state.keyAtDelete = null;

    const res = await uploadBusinessLogo({
      base64Data: VALID_PNG_BASE64,
    });
    const data = expectSuccess(res);

    expect(state.events.filter((e) => e === `delete:${previousKey}`).length).toBe(1);
    expect(state.keyAtDelete).toBe(data.storageKey);

    const bizRes = await pg.query<{ logo_storage_key: string | null }>(
      'SELECT logo_storage_key FROM businesses WHERE id = $1',
      [businessId],
    );
    expect(bizRes.rows[0]?.logo_storage_key).toBe(data.storageKey);
  });

  it('STEP-0: storage upload failure changes nothing', async () => {
    const previousKey = `logos/${businessId}/prev-logo-test3.png`;
    await pg.query('UPDATE businesses SET logo_storage_key = $1 WHERE id = $2', [previousKey, businessId]);

    const auditCountBefore = await pg.query<{ count: string }>(
      "SELECT count(*) as count FROM audit_log WHERE business_id = $1 AND action = 'logo_upload'",
      [businessId],
    );

    state.events = [];
    state.keyAtDelete = null;
    state.failUpload = true;

    const res = await uploadBusinessLogo({
      base64Data: VALID_PNG_BASE64,
    });
    const failure = expectFailure(res);
    expect(failure.code).toBe('STORAGE_UPLOAD_FAILED');

    const bizRes = await pg.query<{ logo_storage_key: string | null }>(
      'SELECT logo_storage_key FROM businesses WHERE id = $1',
      [businessId],
    );
    expect(bizRes.rows[0]?.logo_storage_key).toBe(previousKey);

    expect(state.events.filter((e) => e.startsWith('delete:')).length).toBe(0);

    const auditCountAfter = await pg.query<{ count: string }>(
      "SELECT count(*) as count FROM audit_log WHERE business_id = $1 AND action = 'logo_upload'",
      [businessId],
    );
    expect(auditCountAfter.rows[0]?.count).toBe(auditCountBefore.rows[0]?.count);
  });

  it('STEP-0: DB failure after upload rolls back and cleans only the new object', async () => {
    const previousKey = `logos/${businessId}/prev-logo-test4.png`;
    await pg.query('UPDATE businesses SET logo_storage_key = $1 WHERE id = $2', [previousKey, businessId]);

    state.events = [];
    state.keyAtDelete = null;
    state.failAudit = true;

    const res = await uploadBusinessLogo({
      base64Data: VALID_PNG_BASE64,
    });
    const failure = expectFailure(res);
    expect(failure.code).toBe('INTERNAL_ERROR');

    const bizRes = await pg.query<{ logo_storage_key: string | null }>(
      'SELECT logo_storage_key FROM businesses WHERE id = $1',
      [businessId],
    );
    expect(bizRes.rows[0]?.logo_storage_key).toBe(previousKey);

    const uploadEvent = state.events.find((e) => e.startsWith('upload:'));
    expect(uploadEvent).toBeDefined();
    const newKey = uploadEvent?.slice('upload:'.length);

    expect(state.events.filter((e) => e.startsWith('delete:'))).toEqual([`delete:${newKey}`]);
    expect(state.events.includes(`delete:${previousKey}`)).toBe(false);
  });

  it('STEP-0: remove clears the DB first and keeps a referenced logo', async () => {
    const referencedKey = `logos/${businessId}/ref-logo-test5.png`;
    await createFinalizedInvoice(referencedKey);

    state.events = [];
    state.keyAtDelete = null;

    const res = await removeBusinessLogo({});
    expectSuccess(res);

    const bizRes = await pg.query<{ logo_storage_key: string | null }>(
      'SELECT logo_storage_key FROM businesses WHERE id = $1',
      [businessId],
    );
    expect(bizRes.rows[0]?.logo_storage_key).toBeNull();

    const auditRes = await pg.query<{ metadata: unknown }>(
      `SELECT metadata FROM audit_log WHERE business_id = $1 AND action = 'logo_remove' ORDER BY created_at DESC LIMIT 1`,
      [businessId],
    );
    const meta = auditRes.rows[0]?.metadata;
    if (!isRecord(meta)) {
      throw new Error('Audit metadata is not a record');
    }
    expect(meta.previous_logo_storage_key).toBe(referencedKey);

    expect(state.events.includes(`delete:${referencedKey}`)).toBe(false);
    expect(state.events.filter((e) => e.startsWith('delete:')).length).toBe(0);
  });

  it('STEP-0: remove deletes an unreferenced logo only after the DB is cleared', async () => {
    const unreferencedKey = `logos/${businessId}/unref-logo-test6.png`;
    await pg.query('UPDATE businesses SET logo_storage_key = $1 WHERE id = $2', [unreferencedKey, businessId]);

    state.events = [];
    state.keyAtDelete = 'not-null';

    const res = await removeBusinessLogo({});
    expectSuccess(res);

    const bizRes = await pg.query<{ logo_storage_key: string | null }>(
      'SELECT logo_storage_key FROM businesses WHERE id = $1',
      [businessId],
    );
    expect(bizRes.rows[0]?.logo_storage_key).toBeNull();

    expect(state.events.filter((e) => e.startsWith('delete:'))).toEqual([`delete:${unreferencedKey}`]);
    expect(state.keyAtDelete).toBeNull();
  });

  it('STEP-0: remove with a DB failure deletes nothing', async () => {
    const existingKey = `logos/${businessId}/existing-logo-test7.png`;
    await pg.query('UPDATE businesses SET logo_storage_key = $1 WHERE id = $2', [existingKey, businessId]);

    state.events = [];
    state.keyAtDelete = null;
    state.failAudit = true;

    const res = await removeBusinessLogo({});
    const failure = expectFailure(res);
    expect(failure.code).toBe('INTERNAL_ERROR');

    const bizRes = await pg.query<{ logo_storage_key: string | null }>(
      'SELECT logo_storage_key FROM businesses WHERE id = $1',
      [businessId],
    );
    expect(bizRes.rows[0]?.logo_storage_key).toBe(existingKey);

    expect(state.events.filter((e) => e.startsWith('delete:')).length).toBe(0);
  });

  it('STEP-0: remove when there is no logo is a no-op', async () => {
    await pg.query('UPDATE businesses SET logo_storage_key = NULL WHERE id = $1', [businessId]);

    const auditCountBefore = await pg.query<{ count: string }>(
      "SELECT count(*) as count FROM audit_log WHERE business_id = $1 AND action = 'logo_remove'",
      [businessId],
    );

    state.events = [];
    state.keyAtDelete = null;

    const res = await removeBusinessLogo({});
    expectSuccess(res);

    const bizRes = await pg.query<{ logo_storage_key: string | null }>(
      'SELECT logo_storage_key FROM businesses WHERE id = $1',
      [businessId],
    );
    expect(bizRes.rows[0]?.logo_storage_key).toBeNull();

    expect(state.events.filter((e) => e.startsWith('delete:')).length).toBe(0);

    const auditCountAfter = await pg.query<{ count: string }>(
      "SELECT count(*) as count FROM audit_log WHERE business_id = $1 AND action = 'logo_remove'",
      [businessId],
    );
    expect(auditCountAfter.rows[0]?.count).toBe(auditCountBefore.rows[0]?.count);
  });
});
