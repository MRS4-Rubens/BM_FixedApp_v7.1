import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/lib/db/schema';

const ADMIN_EMAIL = 'admin@test.dev';
const ADMIN_USER_ID = 'a0000000-0000-4000-8000-000000000099';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: 'a0000000-0000-4000-8000-000000000099',
  businessId: null as string | null,
  sessionUserEmail: 'admin@test.dev' as string | null,
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

vi.mock('@/lib/auth/server', () => ({
  auth: {
    getSession: async () => ({
      data: {
        user: state.sessionUserEmail
          ? {
              id: ADMIN_USER_ID,
              email: state.sessionUserEmail,
              emailVerified: true,
            }
          : null,
      },
    }),
  },
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: () => undefined,
  logWarn: () => undefined,
}));
vi.mock('@/lib/storage/idrive', () => ({
  uploadFileToStorage: async () => undefined,
  getSignedDownloadUrl: async () => 'https://mock-storage.test/download',
}));
vi.mock('@/lib/email/mailer', () => ({
  getMailer: () => ({
    emails: {
      send: async () => ({ id: 'mock-email-id' }),
    },
  }),
}));
vi.mock('@/lib/env', () => ({
  getAppEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://test.app' }),
  getEmailEnv: () => ({ EMAIL_FROM: 'noreply@test.app' }),
  getAdminEnv: () => ({
    PLATFORM_ADMIN_EMAILS: [ADMIN_EMAIL],
    PLATFORM_ADMIN_USER_IDS: [ADMIN_USER_ID],
  }),
}));

import { updatePlatformPayeeAction } from '@/lib/actions/subscriptions/update-platform-payee';
import { updateBusinessSubscription } from '@/lib/actions/subscriptions/update-business-subscription';
import { submitPaymentClaim } from '@/lib/actions/subscriptions/submit-payment-claim';

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

describe('ADMIN-PAYEE-FIX: Admin payee hardening and immutability', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg, readJournal());
    state.db = drizzle(pg, { schema });

    await pg.query(
      `INSERT INTO users (id, auth_user_id, email, business_id, role)
       VALUES ($1, 'admin_auth', $2, NULL, 'owner')`,
      [ADMIN_USER_ID, ADMIN_EMAIL]
    );
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(() => {
    process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
    state.sessionUserEmail = ADMIN_EMAIL;
    state.userId = ADMIN_USER_ID;
    state.businessId = null;
  });

  async function createBusinessWithOwner(
    gstin: string,
    legalName: string,
    ownerEmail: string
  ): Promise<{ businessId: string; ownerUserId: string }> {
    const businessId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status
      ) VALUES ($1, $2, '123 Main St', 'Bengaluru', '29', '560001', 'free', 'expired') RETURNING id`,
      [legalName, gstin]
    );

    const ownerUserId = await insertOne(
      pg,
      `INSERT INTO users (auth_user_id, email, business_id, role)
       VALUES ($1, $2, $3, 'owner') RETURNING id`,
      [`auth_${gstin}`, ownerEmail, businessId]
    );

    return { businessId, ownerUserId };
  }

  it('1. updatePlatformPayeeAction writes history with old_value null then old_value = first config', async () => {
    const config1 = {
      upiId: 'payee1@okhdfc',
      upiName: 'Bill Matrix 1',
      bankName: 'HDFC Bank',
      accName: 'Bill Matrix Current',
      accNo: '50200011111111',
      ifsc: 'HDFC0001111',
    };

    const res1 = await updatePlatformPayeeAction(config1);
    expect(res1.success).toBe(true);

    const historyRows1 = await pg.query<{
      key: string;
      old_value: unknown;
      new_value: unknown;
      changed_by: string;
    }>('SELECT key, old_value, new_value, changed_by FROM platform_settings_history ORDER BY created_at DESC');

    expect(historyRows1.rows.length).toBe(1);
    expect(historyRows1.rows[0]?.old_value).toBeNull();
    expect(historyRows1.rows[0]?.new_value).toEqual(config1);
    expect(historyRows1.rows[0]?.changed_by).toBe(ADMIN_USER_ID);

    const config2 = {
      upiId: 'payee2@okhdfc',
      upiName: 'Bill Matrix 2',
      bankName: 'HDFC Bank',
      accName: 'Bill Matrix Current',
      accNo: '50200022222222',
      ifsc: 'HDFC0002222',
    };

    const res2 = await updatePlatformPayeeAction(config2);
    expect(res2.success).toBe(true);

    const historyRows2 = await pg.query<{
      key: string;
      old_value: unknown;
      new_value: unknown;
      changed_by: string;
    }>('SELECT key, old_value, new_value, changed_by FROM platform_settings_history ORDER BY created_at DESC');

    expect(historyRows2.rows.length).toBe(2);
    expect(historyRows2.rows[0]?.old_value).toEqual(config1);
    expect(historyRows2.rows[0]?.new_value).toEqual(config2);
  });

  it('2. updatePlatformPayeeAction rejects placeholder upiId with PAYEE_INVALID and writes nothing', async () => {
    const beforeCount = await pg.query<{ count: string }>('SELECT count(*) FROM platform_settings_history');

    const badRes = await updatePlatformPayeeAction({
      upiId: 'admin@okaxis', // Placeholder
      upiName: 'Bill Matrix Solutions',
      bankName: 'HDFC Bank',
      accName: 'Bill Matrix Current A/C',
      accNo: '50200033333333',
      ifsc: 'HDFC0003333',
    });

    expect(badRes.success).toBe(false);
    if (!badRes.success) {
      expect(badRes.error.code).toBe('PAYEE_INVALID');
    }

    const afterCount = await pg.query<{ count: string }>('SELECT count(*) FROM platform_settings_history');
    expect(afterCount.rows[0]?.count).toBe(beforeCount.rows[0]?.count);
  });

  it('3. UPDATE and DELETE on platform_settings_history both throw via trigger', async () => {
    await expect(
      pg.query("UPDATE platform_settings_history SET key = 'hacked'")
    ).rejects.toThrow(/platform_settings_history is append-only/i);

    await expect(
      pg.query('DELETE FROM platform_settings_history')
    ).rejects.toThrow(/platform_settings_history is append-only/i);

    await expect(
      pg.query('TRUNCATE platform_settings_history')
    ).rejects.toThrow(/platform_settings_history is append-only/i);
  });

  it('3b. platform_settings.updated_by is cleared (not blocking) when the admin user row is deleted', async () => {
    const fk = await pg.query<{ confdeltype: string }>(
      "SELECT confdeltype FROM pg_constraint WHERE conname = 'platform_settings_updated_by_users_id_fk'"
    );
    expect(fk.rows[0]?.confdeltype).toBe('n'); // 'n' = ON DELETE SET NULL
  });

  it('4. Directly updating subscription_requests.amount_paise or paid_to_vpa throws; status/approved_at succeeds', async () => {
    const { businessId, ownerUserId } = await createBusinessWithOwner(
      '29AAAAA0001A1Z1',
      'Immutable Test Corp',
      'immutable@test.dev'
    );

    const reqId = await insertOne(
      pg,
      `INSERT INTO subscription_requests (
        business_id, user_id, plan_name, billing_cycle, amount_paise,
        payment_method, payment_reference, paid_to_vpa, status
      ) VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', 'UTR_IMMUTABLE_001', 'payee@okaxis', 'pending') RETURNING id`,
      [businessId, ownerUserId]
    );

    // Guarded money field updates must throw
    await expect(
      pg.query('UPDATE subscription_requests SET amount_paise = $1 WHERE id = $2', [99900, reqId])
    ).rejects.toThrow(/subscription_requests payment fields are immutable/i);

    await expect(
      pg.query('UPDATE subscription_requests SET paid_to_vpa = $1 WHERE id = $2', ['hacked@upi', reqId])
    ).rejects.toThrow(/subscription_requests payment fields are immutable/i);

    // Non-guarded updates must succeed
    const updateRes = await pg.query<{ status: string }>(
      "UPDATE subscription_requests SET status = 'approved', approved_at = now() WHERE id = $1 RETURNING status",
      [reqId]
    );
    expect(updateRes.rows[0]?.status).toBe('approved');
  });

  it('5. submitPaymentClaim: bank_transfer stores account+ifsc and null vpa; upi_qr stores vpa and null account/ifsc', async () => {
    // Tenant Bank
    const { businessId: bizBank, ownerUserId: userBank } = await createBusinessWithOwner(
      '29BBBBB0002B1Z2',
      'Bank Claim Corp',
      'bankuser@test.dev'
    );

    state.sessionUserEmail = 'bankuser@test.dev';
    state.userId = userBank;
    state.businessId = bizBank;

    const bankClaimRes = await submitPaymentClaim({
      plan_name: 'essentials',
      billing_cycle: 'monthly',
      payment_method: 'bank_transfer',
      payment_reference: 'UTR-BANK-SNAPSHOT-001',
    });
    expect(bankClaimRes.success).toBe(true);

    const bankReq = await pg.query<{
      paid_to_vpa: string | null;
      paid_to_account: string | null;
      paid_to_bank_ifsc: string | null;
    }>('SELECT paid_to_vpa, paid_to_account, paid_to_bank_ifsc FROM subscription_requests WHERE payment_reference = $1', [
      'UTR-BANK-SNAPSHOT-001',
    ]);
    expect(bankReq.rows[0]?.paid_to_vpa).toBeNull();
    expect(bankReq.rows[0]?.paid_to_account).toBe('50200022222222');
    expect(bankReq.rows[0]?.paid_to_bank_ifsc).toBe('HDFC0002222');

    // Tenant UPI
    const { businessId: bizUpi, ownerUserId: userUpi } = await createBusinessWithOwner(
      '29CCCCC0003C1Z3',
      'Upi Claim Corp',
      'upiuser@test.dev'
    );

    state.sessionUserEmail = 'upiuser@test.dev';
    state.userId = userUpi;
    state.businessId = bizUpi;

    const upiClaimRes = await submitPaymentClaim({
      plan_name: 'essentials',
      billing_cycle: 'monthly',
      payment_method: 'upi_qr',
      payment_reference: 'UTR-UPI-SNAPSHOT-001',
    });
    expect(upiClaimRes.success).toBe(true);

    const upiReq = await pg.query<{
      paid_to_vpa: string | null;
      paid_to_account: string | null;
      paid_to_bank_ifsc: string | null;
    }>('SELECT paid_to_vpa, paid_to_account, paid_to_bank_ifsc FROM subscription_requests WHERE payment_reference = $1', [
      'UTR-UPI-SNAPSHOT-001',
    ]);
    expect(upiReq.rows[0]?.paid_to_vpa).toBe('payee2@okhdfc');
    expect(upiReq.rows[0]?.paid_to_account).toBeNull();
    expect(upiReq.rows[0]?.paid_to_bank_ifsc).toBeNull();
  });

  it('6. updateBusinessSubscription ledger row has subscription_ends_at equal to override end date', async () => {
    state.sessionUserEmail = ADMIN_EMAIL;
    state.userId = ADMIN_USER_ID;
    state.businessId = null;

    const { businessId } = await createBusinessWithOwner(
      '29DDDDD0004D1Z4',
      'Override EndsAt Corp',
      'override@test.dev'
    );

    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const futureDateIso = futureDate.toISOString();

    const overrideRes = await updateBusinessSubscription({
      business_id: businessId,
      subscription_plan: 'essentials',
      subscription_status: 'active',
      subscription_ends_at: futureDateIso,
      reason: 'Test override',
    });
    expect(overrideRes.success).toBe(true);

    const ledgerRows = await pg.query<{
      payment_method: string;
      subscription_ends_at: Date | string | null;
    }>(
      "SELECT payment_method, subscription_ends_at FROM subscription_requests WHERE business_id = $1 AND payment_method = 'manual_override'",
      [businessId]
    );

    expect(ledgerRows.rows.length).toBe(1);
    expect(ledgerRows.rows[0]?.payment_method).toBe('manual_override');
    const endsAt = ledgerRows.rows[0]?.subscription_ends_at;
    expect(endsAt).not.toBeNull();
    const recordedMs = endsAt instanceof Date ? endsAt.getTime() : new Date(endsAt as string).getTime();
    expect(recordedMs).toBe(futureDate.getTime());
  });
});
