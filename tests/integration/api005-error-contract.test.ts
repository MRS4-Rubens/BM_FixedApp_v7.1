import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import { getPgError } from '@/lib/db/pg-error';

interface LogCall {
  readonly scope: string;
  readonly error: unknown;
  readonly meta?: unknown;
}

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: '00000000-0000-0000-0000-000000000001',
  businessId: null as string | null,
  resendSendResult: () =>
    ({ data: { id: 'mock-email-id' }, error: null }) as {
      data?: { id: string } | null;
      error?: { name: string; message: string } | null;
    },
  logErrorCalls: [] as LogCall[],
}));

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
  getDb() {
    return state.db;
  },
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({
    id: state.userId,
    business_id: state.businessId,
    role: 'owner' as const,
    email: 'user@test.dev',
    display_name: 'Test Actor',
  }),
}));

vi.mock('@/lib/auth/server', () => ({
  auth: {
    getSession: async () => ({
      data: {
        user: {
          id: state.userId,
          email: 'user@test.dev',
          emailVerified: true,
        },
      },
    }),
  },
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}));

vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  emailBurstLimiter: {},
  emailDailyCapLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));

vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: (scope: string, error: unknown, meta?: unknown) => {
    state.logErrorCalls.push({ scope, error, meta });
  },
}));

vi.mock('@/lib/storage/idrive', () => ({
  getFileBuffer: async () => Buffer.from('%PDF-1.4 mock content'),
  uploadFileToStorage: async () => undefined,
  getSignedDownloadUrl: async () => 'https://mock-storage.test/download',
}));

vi.mock('@/lib/email/templates/invoice-delivery-email', () => ({
  default: () => null,
}));

vi.mock('@/lib/email/templates/payment-reminder-email', () => ({
  default: () => null,
}));

vi.mock('@/lib/email/resend', () => ({
  getResend: () => ({
    emails: {
      send: async () => state.resendSendResult(),
    },
  }),
}));

vi.mock('@/lib/env', () => ({
  getAppEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://test.app' }),
  getEmailEnv: () => ({ RESEND_FROM_EMAIL: 'noreply@test.app' }),
  getAdminEnv: () => ({
    PLATFORM_ADMIN_EMAILS: ['admin@test.app'],
    PLATFORM_ADMIN_USER_IDS: ['00000000-0000-0000-0000-000000000099'],
  }),
  getDatabaseEnv: () => ({ DATABASE_URL: 'postgresql://mock:mock@localhost:5432/mock' }),
}));

import { saveBusinessProfile } from '@/lib/actions/business/save-business-profile';
import { createCustomer } from '@/lib/actions/customers/create-customer';
import { emailInvoice } from '@/lib/actions/invoices/email-invoice';
import { sendPaymentReminder } from '@/lib/actions/invoices/send-payment-reminder';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

function readJournal(): readonly JournalEntry[] {
  const raw = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  return raw.entries;
}

async function applyMigrations(pg: PGlite, entries: readonly JournalEntry[]): Promise<void> {
  for (const entry of entries) {
    const rawSql = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8');
    const statements = rawSql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await pg.exec(stmt);
    }
  }
}

describe('API-005: Error handling contract and information leakage prevention', () => {
  let pg: PGlite;
  type PgliteDb = ReturnType<typeof drizzle<typeof schema>>;
  let realDrizzleDb: PgliteDb;

  const BIZ_A_ID = '11111111-1111-1111-1111-111111111111';
  const BIZ_B_ID = '22222222-2222-2222-2222-222222222222';
  const SHARED_GSTIN = '29AABCU9603R1ZM';

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg, readJournal());
    realDrizzleDb = drizzle(pg, { schema });
    state.db = realDrizzleDb;

    // Seed Business A with SHARED_GSTIN
    await pg.query(
      `INSERT INTO businesses (
        id, legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status
      ) VALUES (
        $1, 'Business Alpha', $2, '123 MG Road', 'Bengaluru', '29', '560001',
        'free', 'active'
      )`,
      [BIZ_A_ID, SHARED_GSTIN],
    );

    // Seed Business B
    await pg.query(
      `INSERT INTO businesses (
        id, legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status
      ) VALUES (
        $1, 'Business Beta', '29XYZAB1234C1Z1', '456 Residency Road', 'Bengaluru', '29', '560025',
        'free', 'active'
      )`,
      [BIZ_B_ID],
    );

    // Seed test users
    await pg.query(
      `INSERT INTO users (id, auth_user_id, business_id, email, display_name, role)
       VALUES ('00000000-0000-0000-0000-000000000001', 'auth_user_001', $1, 'user1@test.dev', 'User One', 'owner'),
              ('00000000-0000-0000-0000-000000000002', 'auth_user_002', $2, 'user2@test.dev', 'User Two', 'owner')`,
      [BIZ_A_ID, BIZ_B_ID],
    );
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(() => {
    state.db = realDrizzleDb;
    state.userId = '00000000-0000-0000-0000-000000000002';
    state.businessId = BIZ_B_ID;
    state.logErrorCalls = [];
    state.resendSendResult = () => ({ data: { id: 'mock-email-id' }, error: null });
  });

  it('1. saveBusinessProfile with duplicate GSTIN returns mapped ActionError without leaking DB internals', async () => {
    state.userId = '00000000-0000-0000-0000-000000000002';
    state.businessId = BIZ_B_ID;

    const res = await saveBusinessProfile({
      legal_name: 'Business Beta Renamed',
      gstin: SHARED_GSTIN, // Collides with Business A!
      registration_type: 'regular',
      address_line1: '456 Residency Road',
      city: 'Bengaluru',
      state_code: '29',
      pincode: '560025',
    });

    expect(res.success).toBe(false);
    if (res.success) return;

    expect(['DUPLICATE_GSTIN', 'GSTIN_ALREADY_REGISTERED']).toContain(res.error.code);
    expect(res.error.fieldErrors?.gstin?.[0]).toMatch(/already registered/);
    expect(res.error.message).not.toContain('businesses_gstin_unique');
    expect(res.error.message).not.toContain('Key (gstin)=');
    expect(res.error.message).not.toContain('duplicate key');

    // Expected business failure must NOT be logged as an unexpected failure ({ expected: false })
    const unexpectedLogs = state.logErrorCalls.filter(
      (c) => typeof c.meta === 'object' && c.meta !== null && (c.meta as Record<string, unknown>).expected === false,
    );
    expect(unexpectedLogs).toHaveLength(0);
  });

  it('2. saveBusinessProfile with forced DB error returns generic INTERNAL_ERROR and logs once as expected: false', async () => {
    state.userId = '00000000-0000-0000-0000-000000000002';
    state.businessId = BIZ_B_ID;

    // Simulate unexpected DB driver / connection failure
    const brokenDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => [
              {
                subscription_plan: 'free',
                subscription_status: 'active',
                trial_ends_at: null,
                subscription_ends_at: null,
              },
            ],
          }),
        }),
      }),
      transaction: async () => {
        throw new Error('Connection terminated unexpectedly');
      },
    };
    state.db = brokenDb;

    const res = await saveBusinessProfile({
      legal_name: 'Business Beta',
      gstin: '29XYZAB1234C1Z1',
      registration_type: 'regular',
      address_line1: '456 Residency Road',
      city: 'Bengaluru',
      state_code: '29',
      pincode: '560025',
    });

    expect(res.success).toBe(false);
    if (res.success) return;

    expect(res.error.code).toBe('INTERNAL_ERROR');
    expect(res.error.message).toBe(
      'Something went wrong on our end. Please try again, and contact support if the problem continues.',
    );
    expect(res.error.message).not.toContain('Connection terminated');

    // Must be logged exactly once with expected: false
    const unexpectedLogs = state.logErrorCalls.filter(
      (c) =>
        c.scope === 'save-business-profile' &&
        typeof c.meta === 'object' &&
        c.meta !== null &&
        (c.meta as Record<string, unknown>).expected === false,
    );
    expect(unexpectedLogs).toHaveLength(1);
    expect((unexpectedLogs[0].error as Error).message).toBe('Connection terminated unexpectedly');
  });

  it('3. createCustomer with DB throw returns generic INTERNAL_ERROR and logs once with expected: false', async () => {
    state.userId = '00000000-0000-0000-0000-000000000002';
    state.businessId = BIZ_B_ID;

    // Simulate unexpected DB throw during insert
    const brokenDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => [{ id: BIZ_B_ID, subscription_plan: 'professional' }],
            orderBy: () => [],
          }),
        }),
      }),
      insert: () => {
        throw new Error('Disk full: cannot extend relation');
      },
    };
    state.db = brokenDb;

    const res = await createCustomer({
      name: 'Acme Test Customer',
      state_code: '29',
      city: 'Bengaluru',
    });

    expect(res.success).toBe(false);
    if (res.success) return;

    expect(res.error.code).toBe('INTERNAL_ERROR');
    expect(res.error.message).toBe(
      'Something went wrong on our end. Please try again, and contact support if the problem continues.',
    );
    expect(res.error.message).not.toContain('Disk full');

    const unexpectedLogs = state.logErrorCalls.filter(
      (c) =>
        c.scope === 'create-customer' &&
        typeof c.meta === 'object' &&
        c.meta !== null &&
        (c.meta as Record<string, unknown>).expected === false,
    );
    expect(unexpectedLogs).toHaveLength(1);
  });

  it('4. Real DB duplicate GSTIN insert error passes through getPgError with code 23505 and constraint businesses_gstin_unique', async () => {
    let caught: unknown = null;
    try {
      await realDrizzleDb.insert(schema.businesses).values({
        legal_name: 'Colliding Business',
        gstin: SHARED_GSTIN, // Duplicate GSTIN
        address_line1: '999 Indiranagar',
        city: 'Bengaluru',
        state_code: '29',
        pincode: '560038',
      });
    } catch (err: unknown) {
      caught = err;
    }

    expect(caught).not.toBeNull();
    const pgErr = getPgError(caught);
    expect(pgErr.code).toBe('23505');
    expect(pgErr.constraint).toBe('businesses_gstin_unique');
  });

  it('5. emailInvoice with Resend provider error returns static message without leaking secrets', async () => {
    state.userId = '00000000-0000-0000-0000-000000000002';
    state.businessId = BIZ_B_ID;

    // Seed financial year, customer and invoice
    const fyRes = await pg.query<{ id: string }>(
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true)
       RETURNING id`,
      [BIZ_B_ID],
    );
    const financialYearId = fyRes.rows[0].id;

    const customerRes = await pg.query<{ id: string }>(
      `INSERT INTO customers (business_id, name, email, state_code, is_active)
       VALUES ($1, 'Email Test Customer', 'billing@customer.dev', '29', true)
       RETURNING id`,
      [BIZ_B_ID],
    );
    const customerId = customerRes.rows[0].id;

    const invoiceRes = await pg.query<{ id: string }>(
      `INSERT INTO invoices (
        business_id, financial_year_id, customer_id, invoice_number, invoice_sequence,
        invoice_date, due_date, finalized_at, grand_total_paise,
        lifecycle_status, archival_status, pdf_storage_key,
        seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_snapshot_source
      ) VALUES (
        $1, $2, $3, 'INV-2026-001', 1,
        '2026-04-01', '2026-04-15', now(), 100000,
        'finalized', 'archived', 'invoices/2026/inv-001.pdf',
        'Business Beta', '{"city":"Bengaluru"}'::jsonb, '29', 'captured_at_finalization'
      ) RETURNING id`,
      [BIZ_B_ID, financialYearId, customerId],
    );
    const invoiceId = invoiceRes.rows[0].id;

    // Mock Resend returning provider-level error
    state.resendSendResult = () => ({
      data: null,
      error: {
        name: 'validation_error',
        message: 'provider secret detail: api_key is restricted from domain test.dev',
      },
    });

    const res = await emailInvoice({ invoiceId });

    expect(res.success).toBe(false);
    if (res.success) return;

    expect(res.error.message).toMatch(/^We could not send the e-?mail\. Please try again\.$/);
    expect(res.error.message).not.toContain('provider secret detail');
    expect(res.error.message).not.toContain('api_key');

    // Verify provider error was logged with diagnostic details (not leaked to user)
    const providerLogs = state.logErrorCalls.filter(
      (c) =>
        (c.scope === 'email-invoice' || c.scope === 'customer-email') &&
        (c.meta as Record<string, unknown> | undefined)?.expected !== true,
    );
    expect(providerLogs).toHaveLength(1);
    expect((providerLogs[0].error as Error).message).toContain('provider secret detail');
  });

  it('6. sendPaymentReminder with Resend network throw returns static message without leaking details', async () => {
    state.userId = '00000000-0000-0000-0000-000000000002';
    state.businessId = BIZ_B_ID;

    // Fetch existing customer and invoice from previous test
    const invoiceRes = await pg.query<{ id: string }>(
      `SELECT id FROM invoices WHERE business_id = $1 LIMIT 1`,
      [BIZ_B_ID],
    );
    const invoiceId = invoiceRes.rows[0].id;

    // Mock Resend throwing network/socket error
    state.resendSendResult = () => {
      throw new Error('ETIMEDOUT: upstream host 198.51.100.1 unreachable on port 443');
    };

    const res = await sendPaymentReminder({ invoiceId });

    expect(res.success).toBe(false);
    if (res.success) return;

    expect(res.error.message).toMatch(/^We could not send the e-?mail\. Please try again\.$/);
    expect(res.error.message).not.toContain('ETIMEDOUT');
    expect(res.error.message).not.toContain('198.51.100.1');

    // Verify logged once with diagnostic details
    const reminderLogs = state.logErrorCalls.filter(
      (c) =>
        (c.scope === 'send-payment-reminder' || c.scope === 'customer-email') &&
        (c.meta as Record<string, unknown> | undefined)?.expected !== true,
    );
    expect(reminderLogs).toHaveLength(1);
    expect((reminderLogs[0].error as Error).message).toContain('ETIMEDOUT');
  });
});
