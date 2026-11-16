import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/lib/db/schema';

/**
 * Feature D1 (bulk customer / product import) against a real Postgres engine (PGlite) with every migration applied.
 * The signed-in person is switched per test through `state`; getCurrentAppUser re-reads the users row,
 * exactly like production, so role / business changes made by an action are seen by the next call.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: '',
  session: null as { email: string | null; emailVerified: boolean } | null,
  sentEmails: [] as Array<{ to: string[]; inviteUrl: string }>,
  failEmail: false,
  cookieJar: new Map<string, string>(),
}));

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => {
    const { eq } = await import('drizzle-orm');
    const { users } = await import('@/lib/db/schema');
    const database = state.db as ReturnType<typeof drizzle<typeof schema>>;
    const [row] = await database.select().from(users).where(eq(users.id, state.userId)).limit(1);
    return row;
  },
}));

vi.mock('@/lib/auth/server', () => ({
  auth: {
    getSession: async () => ({
      data: state.session
        ? { user: { id: 'auth-id', email: state.session.email, emailVerified: state.session.emailVerified } }
        : null,
    }),
  },
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => {
      const value = state.cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    delete: (name: string) => {
      state.cookieJar.delete(name);
    },
    set: (name: string, value: string) => {
      state.cookieJar.set(name, value);
    },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  exportLimiter: {},
  defaultActionLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: () => undefined, logWarn: () => undefined }));
vi.mock('@/lib/email/resend', () => ({
  getResend: () => ({
    emails: {
      send: async (message: { to: string[]; react: { props: { inviteUrl: string } } }) => {
        if (state.failEmail) return { error: { name: 'mock', message: 'mock failure' } };
        state.sentEmails.push({ to: message.to, inviteUrl: message.react.props.inviteUrl });
        return { data: { id: 'mock-email-id' }, error: null };
      },
    },
  }),
}));
vi.mock('@/lib/env', () => ({
  getAppEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://test.app' }),
  getEmailEnv: () => ({ RESEND_FROM_EMAIL: 'noreply@test.app' }),
  getAdminEnv: () => ({ PLATFORM_ADMIN_EMAILS: [], PLATFORM_ADMIN_USER_IDS: [] }),
}));

import ExcelJS from 'exceljs';
import { checkBulkImport } from '@/lib/actions/import/check-bulk-import';
import { runBulkImport } from '@/lib/actions/import/run-bulk-import';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJournalTags(): string[] {
  const raw: unknown = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'));
  if (!isRecord(raw) || !Array.isArray(raw.entries)) throw new Error('journal has no entries array');
  return raw.entries.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.tag !== 'string') throw new Error('malformed journal entry');
    return entry.tag;
  });
}

async function applyMigrations(pg: PGlite): Promise<void> {
  for (const tag of readJournalTags()) {
    const statements = readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) await pg.exec(statement);
  }
}

describe('D1: bulk import (PGlite, all migrations)', () => {
  let pg: PGlite;
  let seq = 0;

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg);
    state.db = drizzle(pg, { schema });
  }, 120_000);

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(() => {
    state.sentEmails = [];
    state.failEmail = false;
    state.session = null;
    state.cookieJar.clear();
  });

  async function one(sqlText: string, params: unknown[]): Promise<string> {
    const result = await pg.query<{ id: string }>(sqlText, params);
    const row = result.rows[0];
    if (!row) throw new Error(`no row for ${sqlText}`);
    return row.id;
  }

  async function createUser(email: string, businessId: string | null, role: 'owner' | 'staff' | 'accountant' = 'owner'): Promise<string> {
    seq += 1;
    return one(
      `INSERT INTO users (auth_user_id, email, business_id, role, display_name) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [`auth_${seq}_${email}`, email, businessId, role, `User ${seq}`],
    );
  }

  /** A business on the given plan with its owner; signs the owner in. */
  async function createBusiness(plan: 'essentials' | 'free' | 'professional' = 'essentials') {
    seq += 1;
    const status = plan === 'free' ? 'expired' : 'active';
    const businessId = await one(
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode,
         subscription_plan, subscription_status, subscription_ends_at)
       VALUES ($1, $2, 'Main St', 'Bengaluru', '29', '560001', $3, $4, now() + interval '30 days') RETURNING id`,
      [`Team Biz ${seq}`, `29ABCDE${String(1000 + seq).slice(-4)}F1Z5`, plan, status],
    );
    const ownerEmail = `owner${seq}@biz.test`;
    const ownerId = await createUser(ownerEmail, businessId, 'owner');
    signIn(ownerId, ownerEmail);
    return { businessId, ownerId, ownerEmail };
  }

  function signIn(userId: string, email: string | null, emailVerified = true): void {
    state.userId = userId;
    state.session = { email, emailVerified };
  }

  async function errorCode(promise: Promise<{ success: boolean; error?: { code?: string } }>): Promise<string> {
    const result = await promise;
    return result.success ? 'OK' : (result.error?.code ?? 'UNKNOWN');
  }

  async function xlsx(rows: (string | number)[][]): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Data');
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
  }

  const VALID_GSTIN = '29ABCDE1234F1ZW';
  const OTHER_VALID_GSTIN = '27AAACR5055K1Z7';
  const CUSTOMER_HEADER = ['Name', 'GSTIN', 'State', 'Pincode'];
  const PRODUCT_HEADER = ['Name', 'HSN/SAC code', 'Unit', 'Sale price (Rs)', 'GST rate (%)', 'Opening stock'];

  async function seedTaxRates(): Promise<string> {
    const existing = await pg.query<{ id: string }>("SELECT id FROM tax_rates WHERE rate_percentage = 18 AND is_active LIMIT 1");
    if (existing.rows[0]) return existing.rows[0].id;
    await one(`INSERT INTO tax_rates (label, rate_percentage, effective_from) VALUES ('5%', 5, '2017-07-01') RETURNING id`, []);
    return one(`INSERT INTO tax_rates (label, rate_percentage, effective_from) VALUES ('18%', 18, '2017-07-01') RETURNING id`, []);
  }

  it('Professional only: Essentials is refused before the file is even read', async () => {
    await createBusiness('essentials');
    const file = await xlsx([CUSTOMER_HEADER, ['A', '', 'Karnataka', '']]);
    expect(await errorCode(checkBulkImport({ kind: 'customers', file_name: 'c.xlsx', file_base64: file }))).toBe('IMPORT_PLAN_REQUIRED');
    expect(await errorCode(runBulkImport({ kind: 'customers', file_name: 'c.xlsx', file_base64: file }))).toBe('IMPORT_PLAN_REQUIRED');
  });

  it('owner and staff may import; the read-only accountant may not', async () => {
    const { businessId } = await createBusiness('professional');
    const file = await xlsx([CUSTOMER_HEADER, ['A', '', 'Karnataka', '']]);
    const caId = await createUser('ca.imp@firm.test', businessId, 'accountant');
    signIn(caId, 'ca.imp@firm.test');
    expect(await errorCode(checkBulkImport({ kind: 'customers', file_name: 'c.xlsx', file_base64: file }))).toBe('FORBIDDEN_ROLE');
    expect(await errorCode(runBulkImport({ kind: 'customers', file_name: 'c.xlsx', file_base64: file }))).toBe('FORBIDDEN_ROLE');
    const staffId = await createUser('staff.imp@firm.test', businessId, 'staff');
    signIn(staffId, 'staff.imp@firm.test');
    expect(await errorCode(checkBulkImport({ kind: 'customers', file_name: 'c.xlsx', file_base64: file }))).toBe('OK');
  });

  it('check previews every row and writes nothing; run imports the ready rows only, in one go, and audits it', async () => {
    const { businessId } = await createBusiness('professional');
    await pg.query(
      `INSERT INTO customers (business_id, name, gstin, state_code) VALUES ($1, 'Existing', $2, '27')`,
      [businessId, OTHER_VALID_GSTIN],
    );
    const file = await xlsx([
      CUSTOMER_HEADER,
      ['Sharma Traders', VALID_GSTIN, '', '560001'],
      ['Ravi Kumar', '', 'Karnataka', ''],
      ['Already here', OTHER_VALID_GSTIN, '', ''],
      ['', '', 'Nowhere', ''],
    ]);
    const input = { kind: 'customers' as const, file_name: 'customers.xlsx', file_base64: file };

    const checked = await checkBulkImport(input);
    expect(checked.success).toBe(true);
    if (!checked.success) return;
    expect(checked.data.summary).toEqual({ total: 4, ready: 2, duplicates: 1, errors: 1 });
    expect(checked.data.rows.map((row) => [row.rowNumber, row.status])).toEqual([[2, 'ready'], [3, 'ready'], [4, 'duplicate'], [5, 'error']]);
    expect(JSON.stringify(checked.data)).not.toContain('business_id'); // insert payload never leaves the server
    const before = await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM customers WHERE business_id = $1', [businessId]);
    expect(before.rows[0]?.n).toBe(1);

    const run = await runBulkImport(input);
    expect(run.success && run.data.imported).toBe(2);
    const after = await pg.query<{ name: string; gstin: string | null; state_code: string }>(
      'SELECT name, gstin, state_code FROM customers WHERE business_id = $1 ORDER BY name',
      [businessId],
    );
    expect(after.rows).toEqual([
      { name: 'Existing', gstin: OTHER_VALID_GSTIN, state_code: '27' },
      { name: 'Ravi Kumar', gstin: null, state_code: '29' },
      { name: 'Sharma Traders', gstin: VALID_GSTIN, state_code: '29' },
    ]);
    const audit = await pg.query<{ metadata: { imported: number; skipped_duplicates: number; skipped_errors: number } }>(
      "SELECT metadata FROM audit_log WHERE business_id = $1 AND action = 'customers_imported'",
      [businessId],
    );
    expect(audit.rows.map((r) => r.metadata)).toEqual([
      expect.objectContaining({ imported: 2, skipped_duplicates: 1, skipped_errors: 1 }),
    ]);

    // Importing the same file again adds nothing: the new rows are now duplicates.
    expect(await errorCode(runBulkImport(input))).toBe('NOTHING_TO_IMPORT');
  });

  it('products: GST % maps to the real tax rate, units and rupees convert, names dedupe', async () => {
    const rate18 = await seedTaxRates();
    const { businessId } = await createBusiness('professional');
    await pg.query(
      `INSERT INTO products (business_id, name, hsn_sac_code, default_sale_price_paise) VALUES ($1, 'Cotton Shirt', '6205', 49900)`,
      [businessId],
    );
    const file = await xlsx([
      PRODUCT_HEADER,
      ['cotton  SHIRT', '6205', 'PCS', '499', '18', ''],
      ['Green Tea', '0902', 'Kg', '1,250.50', '18%', '40'],
      ['Mystery', '6205', 'PCS', '10', '7', ''],
    ]);
    const run = await runBulkImport({ kind: 'products', file_name: 'products.xlsx', file_base64: file });
    expect(run.success).toBe(true);
    if (!run.success) return;
    expect(run.data.summary).toEqual({ total: 3, ready: 1, duplicates: 1, errors: 1 });
    const tea = await pg.query<{ unit_of_measurement: string; default_sale_price_paise: number; default_tax_rate_id: string; stock_quantity: number }>(
      "SELECT unit_of_measurement, default_sale_price_paise, default_tax_rate_id, stock_quantity FROM products WHERE business_id = $1 AND name = 'Green Tea'",
      [businessId],
    );
    expect(tea.rows[0]).toEqual({ unit_of_measurement: 'KGS', default_sale_price_paise: 125050, default_tax_rate_id: rate18, stock_quantity: 40 });
  });

  it('a file problem is reported as one clear error and nothing is written', async () => {
    const { businessId } = await createBusiness('professional');
    const missing = await xlsx([['Name'], ['Only a name']]);
    expect(await errorCode(checkBulkImport({ kind: 'products', file_name: 'p.xlsx', file_base64: missing }))).toBe('MISSING_COLUMNS');
    expect(await errorCode(runBulkImport({ kind: 'products', file_name: 'p.txt', file_base64: missing }))).toBe('UNSUPPORTED_FILE');
    const count = await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM products WHERE business_id = $1', [businessId]);
    expect(count.rows[0]?.n).toBe(0);
  });
});
