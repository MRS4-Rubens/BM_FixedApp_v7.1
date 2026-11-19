import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';

const state = vi.hoisted(() => {
  const adminEmail = 'admin@test.dev';
  const adminUserId = 'a0000000-0000-4000-8000-000000000099';
  return {
    adminEmail,
    adminUserId,
    regularEmail: 'user@test.dev',
    regularUserId: 'a0000000-0000-4000-8000-000000000001',
    db: undefined as unknown,
    userId: adminUserId,
    businessId: null as string | null,
    role: 'owner' as 'owner' | 'staff',
    sessionUser: {
      id: adminUserId,
      email: adminEmail,
      emailVerified: true,
    } as { id: string; email: string; emailVerified: boolean } | null,
    sendSpy: vi.fn<(payload: { from: string; to: string[]; subject: string; react: { props: Record<string, unknown> } }) => Promise<{ id: string }>>().mockResolvedValue({ id: 'mock-email-id' }),
    signerSpy: vi.fn<(key: string, exp?: number, opts?: { forceDownload?: boolean }) => Promise<string>>().mockResolvedValue('https://mock-storage.test/signed-download'),
    logErrorSpy: vi.fn<(scope: string, err: unknown, meta?: Record<string, unknown>) => void>(),
    // Launch 3.8 follow-up: billing inbox + admin list are switchable per test.
    billingEmail: undefined as string | undefined,
    adminEmails: null as string[] | null,
  };
});

const ADMIN_EMAIL = state.adminEmail;
const ADMIN_USER_ID = state.adminUserId;
const REGULAR_EMAIL = state.regularEmail;
const REGULAR_USER_ID = state.regularUserId;

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({
    id: state.userId,
    business_id: state.businessId,
    role: state.role,
  }),
}));

vi.mock('@/lib/auth/server', () => ({
  auth: {
    getSession: async () => ({
      data: {
        user: state.sessionUser,
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
  logError: (...args: [string, unknown, Record<string, unknown>?]) => state.logErrorSpy(...args),
}));

vi.mock('@/lib/storage/idrive', () => ({
  uploadFileToStorage: async () => undefined,
  deleteFileFromStorage: async () => undefined,
  getSignedDownloadUrl: (...args: [string, number?, { forceDownload?: boolean }?]) => state.signerSpy(...args),
}));

vi.mock('@/lib/email/mailer', () => ({
  getMailer: () => ({
    emails: {
      send: (payload: { from: string; to: string[]; subject: string; react: { props: Record<string, unknown> } }) => state.sendSpy(payload),
    },
  }),
}));

vi.mock('@/lib/env', () => ({
  getAppEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://test.app' }),
  getEmailEnv: () => ({ EMAIL_FROM: 'noreply@test.app' }),
  // BILLING_EMAIL unset by default: payment-claim notices go to the platform admins.
  getContactEnv: () => (state.billingEmail ? { BILLING_EMAIL: state.billingEmail } : {}),
  getAdminEnv: () => ({
    PLATFORM_ADMIN_EMAILS: state.adminEmails ?? [ADMIN_EMAIL],
    PLATFORM_ADMIN_USER_IDS: [ADMIN_USER_ID],
  }),
}));

import { getClaimScreenshotUrl } from '@/lib/actions/subscriptions/get-claim-screenshot-url';
import { getPendingRequests } from '@/lib/actions/subscriptions/get-pending-requests';
import { getBusinessSubscriptions } from '@/lib/actions/subscriptions/get-business-subscriptions';
import { submitPaymentClaim } from '@/lib/actions/subscriptions/submit-payment-claim';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

interface JournalEntry {
  tag: string;
}

function readJournal(): JournalEntry[] {
  const raw = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  return raw.entries;
}

async function applyMigrations(pg: PGlite, entries: JournalEntry[]): Promise<void> {
  for (const entry of entries) {
    const statements = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await pg.exec(statement);
    }
  }
}

const VALID_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('SEC-003: Claim screenshot access integration tests (PGlite)', () => {
  let pg: PGlite;
  let testBusinessId: string;
  let testOtherBusinessId: string;
  let testUserId: string;

  beforeAll(async () => {
    pg = new PGlite();
    const journal = readJournal();
    await applyMigrations(pg, journal);
    state.db = drizzle(pg, { schema });

    // Seed test businesses
    const bRes = await pg.query<{ id: string }>(
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Tenant Alpha Corp', '29ABCDE1234F1Z5', '123 Main St', 'Bengaluru', '29', '560001')
       RETURNING id;`
    );
    testBusinessId = bRes.rows[0].id;

    const b2Res = await pg.query<{ id: string }>(
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Tenant Beta Corp', '27ABCDE1234F1Z6', '456 Side St', 'Mumbai', '27', '400001')
       RETURNING id;`
    );
    testOtherBusinessId = b2Res.rows[0].id;

    // Seed test user
    const uRes = await pg.query<{ id: string }>(
      `INSERT INTO users (business_id, auth_user_id, email, display_name, role)
       VALUES ($1, 'tenantA_auth', 'tenantA@test.dev', 'Tenant Owner', 'owner')
       RETURNING id;`,
      [testBusinessId]
    );
    testUserId = uRes.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    if (pg) {
      await pg.close();
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default to admin caller
    state.userId = ADMIN_USER_ID;
    state.businessId = null;
    state.role = 'owner';
    state.sessionUser = {
      id: ADMIN_USER_ID,
      email: ADMIN_EMAIL,
      emailVerified: true,
    };
  });

  it('1. A signed-in non-admin calling getClaimScreenshotUrl gets UNAUTHORIZED_ACCESS; the signer is never called', async () => {
    // Switch caller to regular non-admin user
    state.userId = REGULAR_USER_ID;
    state.businessId = testBusinessId;
    state.role = 'owner';
    state.sessionUser = {
      id: REGULAR_USER_ID,
      email: REGULAR_EMAIL,
      emailVerified: true,
    };

    const res = await getClaimScreenshotUrl({
      requestId: 'a0000000-0000-4000-8000-000000000001',
    });

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe('UNAUTHORIZED_ACCESS');
    }
    expect(state.signerSpy).not.toHaveBeenCalled();
  });

  it('2. An admin with a request whose key is payment-screenshots/<businessId>/<uuid>.png gets { url, expiresInSeconds: 300 }', async () => {
    const validKey = `payment-screenshots/${testBusinessId}/b0000000-0000-4000-8000-000000000001.png`;
    const reqRes = await pg.query<{ id: string }>(
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, screenshot_storage_key, status)
       VALUES ($1, $2, 'essentials', 'monthly', 199900, 'upi_qr', 'UTR-VALID-PREFIX-01', $3, 'pending')
       RETURNING id;`,
      [testBusinessId, testUserId, validKey]
    );
    const requestId = reqRes.rows[0].id;

    const res = await getClaimScreenshotUrl({ requestId });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.url).toBe('https://mock-storage.test/signed-download');
      expect(res.data.expiresInSeconds).toBe(300);
    }
    expect(state.signerSpy).toHaveBeenCalledTimes(1);
    expect(state.signerSpy).toHaveBeenCalledWith(validKey, 300, { forceDownload: true });
  });

  it('3. Request without a key gives NO_SCREENSHOT; unknown uuid gives NOT_FOUND; malformed id gives VALIDATION_ERROR', async () => {
    // Clean up any existing pending claims for testBusinessId
    await pg.query(`DELETE FROM subscription_requests WHERE business_id = $1;`, [testBusinessId]);

    // 3a. Request without key
    const noKeyReq = await pg.query<{ id: string }>(
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, screenshot_storage_key, status)
       VALUES ($1, $2, 'essentials', 'monthly', 199900, 'upi_qr', 'UTR-NO-KEY-01', NULL, 'pending')
       RETURNING id;`,
      [testBusinessId, testUserId]
    );
    const noKeyId = noKeyReq.rows[0].id;

    const noKeyRes = await getClaimScreenshotUrl({ requestId: noKeyId });
    expect(noKeyRes.success).toBe(false);
    if (!noKeyRes.success) {
      expect(noKeyRes.error.code).toBe('NO_SCREENSHOT');
    }
    expect(state.signerSpy).not.toHaveBeenCalled();

    // 3b. Unknown UUID
    const unknownRes = await getClaimScreenshotUrl({
      requestId: '00000000-0000-4000-8000-000000000000',
    });
    expect(unknownRes.success).toBe(false);
    if (!unknownRes.success) {
      expect(unknownRes.error.code).toBe('NOT_FOUND');
    }
    expect(state.signerSpy).not.toHaveBeenCalled();

    // 3c. Malformed ID (not UUID)
    const malformedRes = await getClaimScreenshotUrl({ requestId: 'not-a-uuid' });
    expect(malformedRes.success).toBe(false);
    if (!malformedRes.success) {
      expect(malformedRes.error.code).toBe('VALIDATION_ERROR');
    }
    expect(state.signerSpy).not.toHaveBeenCalled();
  });

  it('4. Stored key outside expected prefix gives NOT_FOUND, logs error with get-claim-screenshot-url scope, and signer is not called', async () => {
    // Clean up any existing pending claims for testBusinessId
    await pg.query(`DELETE FROM subscription_requests WHERE business_id = $1;`, [testBusinessId]);

    // Key in another business's folder
    const crossTenantKey = `payment-screenshots/${testOtherBusinessId}/evil.png`;
    const crossReq = await pg.query<{ id: string }>(
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, screenshot_storage_key, status)
       VALUES ($1, $2, 'essentials', 'monthly', 199900, 'upi_qr', 'UTR-CROSS-KEY-01', $3, 'pending')
       RETURNING id;`,
      [testBusinessId, testUserId, crossTenantKey]
    );
    const crossId = crossReq.rows[0].id;

    const crossRes = await getClaimScreenshotUrl({ requestId: crossId });
    expect(crossRes.success).toBe(false);
    if (!crossRes.success) {
      expect(crossRes.error.code).toBe('NOT_FOUND');
    }
    expect(state.signerSpy).not.toHaveBeenCalled();
    expect(state.logErrorSpy).toHaveBeenCalledWith(
      'get-claim-screenshot-url',
      expect.any(Error),
      expect.objectContaining({ requestId: crossId })
    );

    // Delete before inserting the next pending claim
    await pg.query(`DELETE FROM subscription_requests WHERE business_id = $1;`, [testBusinessId]);

    // Key in completely arbitrary path
    const arbitraryKey = 'invoices/secret-invoice.pdf';
    const arbReq = await pg.query<{ id: string }>(
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, screenshot_storage_key, status)
       VALUES ($1, $2, 'essentials', 'monthly', 199900, 'upi_qr', 'UTR-ARB-KEY-01', $3, 'pending')
       RETURNING id;`,
      [testBusinessId, testUserId, arbitraryKey]
    );
    const arbId = arbReq.rows[0].id;

    const arbRes = await getClaimScreenshotUrl({ requestId: arbId });
    expect(arbRes.success).toBe(false);
    if (!arbRes.success) {
      expect(arbRes.error.code).toBe('NOT_FOUND');
    }
    expect(state.signerSpy).not.toHaveBeenCalled();
  });

  it('5. getPendingRequests and getBusinessSubscriptions rows contain hasScreenshot and have no screenshotStorageKey property', async () => {
    const pendingRes = await getPendingRequests({});
    expect(pendingRes.success).toBe(true);
    if (pendingRes.success) {
      expect(pendingRes.data.length).toBeGreaterThan(0);
      for (const row of pendingRes.data) {
        expect(typeof row.hasScreenshot).toBe('boolean');
        expect(row).not.toHaveProperty('screenshotStorageKey');
      }
    }

    const bizSubsRes = await getBusinessSubscriptions({ business_id: testBusinessId });
    expect(bizSubsRes.success).toBe(true);
    if (bizSubsRes.success) {
      expect(bizSubsRes.data.length).toBeGreaterThan(0);
      for (const row of bizSubsRes.data) {
        expect(typeof row.hasScreenshot).toBe('boolean');
        expect(row).not.toHaveProperty('screenshotStorageKey');
      }
    }
  });

  it('6. submitPaymentClaim with a screenshot: signer is NOT called; Resend send called with hasScreenshot: true and no screenshotUrl', async () => {
    // Switch to business owner
    state.userId = testUserId;
    state.businessId = testBusinessId;
    state.role = 'owner';
    state.sessionUser = {
      id: testUserId,
      email: 'tenantA@test.dev',
      emailVerified: true,
    };

    // First delete any pending claims for testBusinessId to satisfy single pending claim constraint
    await pg.query(
      `DELETE FROM subscription_requests WHERE business_id = $1 AND status = 'pending';`,
      [testBusinessId]
    );

    const claimRes = await submitPaymentClaim({
      plan_name: 'essentials',
      billing_cycle: 'monthly',
      payment_method: 'upi_qr',
      payment_reference: 'UTR-SUBMIT-SCREENSHOT-01',
      screenshot_base64: VALID_PNG_BASE64,
    });

    expect(claimRes.success).toBe(true);

    // Signer mock must NEVER be called during claim submission
    expect(state.signerSpy).not.toHaveBeenCalled();

    // Resend mock must be called with hasScreenshot: true and no screenshotUrl
    expect(state.sendSpy).toHaveBeenCalledTimes(1);
    const emailPayload = state.sendSpy.mock.calls[0]?.[0];
    expect(emailPayload).toBeDefined();
    if (emailPayload) {
      const emailProps = emailPayload.react.props;
      expect(emailProps.hasScreenshot).toBe(true);
      expect(emailProps.screenshotUrl).toBeUndefined();
      expect(emailProps).not.toHaveProperty('screenshotUrl');
    }
    // Default routing: the admins, from the billing sender name.
    expect(emailPayload?.to).toEqual([ADMIN_EMAIL]);
    expect(emailPayload?.from).toBe('Invoice BizFolio Billing <noreply@test.app>');
  });

  it('7. with BILLING_EMAIL set and NO admin e-mails, the payment-claim notice still goes to the billing inbox', async () => {
    state.userId = testUserId;
    state.businessId = testBusinessId;
    state.role = 'owner';
    state.sessionUser = { id: testUserId, email: 'tenantA@test.dev', emailVerified: true };
    state.billingEmail = 'yourapp+billing@gmail.com';
    state.adminEmails = [];
    state.sendSpy.mockClear();
    try {
      await pg.query(`DELETE FROM subscription_requests WHERE business_id = $1 AND status = 'pending';`, [testBusinessId]);
      const claimRes = await submitPaymentClaim({
        plan_name: 'essentials',
        billing_cycle: 'monthly',
        payment_method: 'upi_qr',
        payment_reference: 'UTR-BILLING-ONLY-01',
      });
      expect(claimRes.success).toBe(true);
      expect(state.sendSpy).toHaveBeenCalledTimes(1);
      expect(state.sendSpy.mock.calls[0]?.[0].to).toEqual(['yourapp+billing@gmail.com']);
    } finally {
      state.billingEmail = undefined;
      state.adminEmails = null;
    }
  });
});
