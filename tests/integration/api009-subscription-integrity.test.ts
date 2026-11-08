import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/lib/db/schema';
import { addBillingCycleUtc } from '@/lib/subscriptions/billing-period';

/**
 * API-009: Subscription integrity, race-condition prevention, and manual override validation.
 *
 * NOTE: PGlite is single-connection; transactions are executed sequentially/queued, so these
 * integration tests prove the guarded-update, atomic state transitions, and re-check logic,
 * NOT physical PostgreSQL row lock contention. Real lock contention is verified manually (§7).
 *
 * NOTE FOR AUTH-001: AUTH-001 will replace the PLATFORM_ADMIN_EMAILS env/session check with
 * requirePlatformAdmin and must update these mocks accordingly.
 */

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
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: () => undefined }));
vi.mock('@/lib/storage/idrive', () => ({
  uploadFileToStorage: async () => undefined,
  getSignedDownloadUrl: async () => 'https://mock-storage.test/download',
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
    PLATFORM_ADMIN_EMAILS: [ADMIN_EMAIL],
    PLATFORM_ADMIN_USER_IDS: [ADMIN_USER_ID],
  }),
}));

import { processSubscriptionClaim } from '@/lib/actions/subscriptions/process-request';
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

interface BusinessRow {
  id: string;
  subscription_plan: string;
  subscription_status: string;
  subscription_ends_at: string | Date | null;
  active_utr_no: string | null;
}

interface RequestRow {
  id: string;
  business_id: string;
  user_id: string;
  plan_name: string;
  billing_cycle: string;
  amount_paise: number;
  payment_method: string;
  payment_reference: string;
  status: string;
  reject_reason: string | null;
  approved_at: string | Date | null;
}

interface AuditRow {
  id: string;
  business_id: string;
  user_id: string | null;
  action: string;
  metadata: unknown;
}

async function insertOne(pg: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const result = await pg.query<IdRow>(sqlText, params);
  const row = result.rows[0];
  if (!row) {
    throw new Error(`no row returned for: ${sqlText}`);
  }
  return row.id;
}

describe('API-009: Subscription approval race and manual override integrity', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg, readJournal());
    state.db = drizzle(pg, { schema });

    await pg.query(
      `INSERT INTO users (id, auth_user_id, email, business_id, role)
       VALUES ($1, 'admin_auth', $2, NULL, 'owner')`,
      [ADMIN_USER_ID, ADMIN_EMAIL],
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
    ownerEmail: string,
    initialPlan = 'free',
    initialStatus = 'expired',
    endsAt: string | null = null,
  ): Promise<{ businessId: string; ownerUserId: string }> {
    const businessId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status, subscription_ends_at
      ) VALUES ($1, $2, '123 Main St', 'Bengaluru', '29', '560001', $3, $4, $5) RETURNING id`,
      [legalName, gstin, initialPlan, initialStatus, endsAt],
    );

    const ownerUserId = await insertOne(
      pg,
      `INSERT INTO users (auth_user_id, email, business_id, role)
       VALUES ($1, $2, $3, 'owner') RETURNING id`,
      [`auth_${gstin}`, ownerEmail, businessId],
    );

    return { businessId, ownerUserId };
  }

  it('1. Double approval: Promise.all of two approvals yields exactly one success, one ALREADY_PROCESSED, and exactly one cycle extension', async () => {
    const { businessId, ownerUserId } = await createBusinessWithOwner(
      '29AAAAA1111A1Z5',
      'Double Approval Corp',
      'owner1@test.dev',
      'free',
      'expired',
      null,
    );

    const requestId = await insertOne(
      pg,
      `INSERT INTO subscription_requests (
        business_id, user_id, plan_name, billing_cycle, amount_paise,
        payment_method, payment_reference, status
      ) VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', 'UTR_DOUBLE_001', 'pending') RETURNING id`,
      [businessId, ownerUserId],
    );

    const [resA, resB] = await Promise.all([
      processSubscriptionClaim({ request_id: requestId, action: 'approve' }),
      processSubscriptionClaim({ request_id: requestId, action: 'approve' }),
    ]);

    const successes = [resA, resB].filter((r) => r.success);
    const failures = [resA, resB].filter((r) => !r.success);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const failed = failures[0];
    if (failed && !failed.success) {
      expect(failed.error.code).toBe('ALREADY_PROCESSED');
      expect(failed.error.message).toBe('This request has already been approved.');
    }

    const bizRows = await pg.query<BusinessRow>('SELECT * FROM businesses WHERE id = $1', [businessId]);
    const biz = bizRows.rows[0];
    if (!biz) throw new Error('Business not found');

    expect(biz.subscription_plan).toBe('essentials');
    expect(biz.subscription_status).toBe('active');
    expect(biz.active_utr_no).toBe('UTR_DOUBLE_001');

    const expectedEnd = addBillingCycleUtc(new Date(), 'monthly');
    const actualEnd = new Date(biz.subscription_ends_at ?? 0);
    expect(Math.abs(actualEnd.getTime() - expectedEnd.getTime())).toBeLessThan(60000);

    const reqRows = await pg.query<RequestRow>('SELECT * FROM subscription_requests WHERE id = $1', [requestId]);
    expect(reqRows.rows.length).toBe(1);
    expect(reqRows.rows[0]?.status).toBe('approved');
  });

  it('2. Early renewal: business active with expiry now+10d extends from old expiry, not now', async () => {
    const tenDaysFuture = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const { businessId, ownerUserId } = await createBusinessWithOwner(
      '29BBBBB2222B1Z5',
      'Early Renewal Corp',
      'owner2@test.dev',
      'essentials',
      'active',
      tenDaysFuture.toISOString(),
    );

    const requestId = await insertOne(
      pg,
      `INSERT INTO subscription_requests (
        business_id, user_id, plan_name, billing_cycle, amount_paise,
        payment_method, payment_reference, status
      ) VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', 'UTR_EARLY_001', 'pending') RETURNING id`,
      [businessId, ownerUserId],
    );

    const res = await processSubscriptionClaim({ request_id: requestId, action: 'approve' });
    expect(res.success).toBe(true);

    const bizRows = await pg.query<BusinessRow>('SELECT * FROM businesses WHERE id = $1', [businessId]);
    const biz = bizRows.rows[0];
    if (!biz) throw new Error('Business not found');

    const expectedEnd = addBillingCycleUtc(tenDaysFuture, 'monthly');
    const actualEnd = new Date(biz.subscription_ends_at ?? 0);
    expect(Math.abs(actualEnd.getTime() - expectedEnd.getTime())).toBeLessThan(5000);
  });

  it('3. Reject then approve -> ALREADY_PROCESSED (rejected); Approve then reject -> ALREADY_PROCESSED (approved)', async () => {
    const { businessId, ownerUserId } = await createBusinessWithOwner(
      '29CCCCC3333C1Z5',
      'Flip Race Corp',
      'owner3@test.dev',
      'free',
      'expired',
      null,
    );

    const req1 = await insertOne(
      pg,
      `INSERT INTO subscription_requests (
        business_id, user_id, plan_name, billing_cycle, amount_paise,
        payment_method, payment_reference, status
      ) VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', 'UTR_FLIP_001', 'pending') RETURNING id`,
      [businessId, ownerUserId],
    );

    const rejectRes = await processSubscriptionClaim({
      request_id: req1,
      action: 'reject',
      reject_reason: 'Invalid reference',
    });
    expect(rejectRes.success).toBe(true);

    const approveAfterReject = await processSubscriptionClaim({ request_id: req1, action: 'approve' });
    expect(approveAfterReject.success).toBe(false);
    if (!approveAfterReject.success) {
      expect(approveAfterReject.error.code).toBe('ALREADY_PROCESSED');
      expect(approveAfterReject.error.message).toBe('This request has already been rejected.');
    }

    const bizRows = await pg.query<BusinessRow>('SELECT * FROM businesses WHERE id = $1', [businessId]);
    expect(bizRows.rows[0]?.subscription_status).toBe('expired');

    const req2 = await insertOne(
      pg,
      `INSERT INTO subscription_requests (
        business_id, user_id, plan_name, billing_cycle, amount_paise,
        payment_method, payment_reference, status
      ) VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', 'UTR_FLIP_002', 'pending') RETURNING id`,
      [businessId, ownerUserId],
    );

    const approveRes = await processSubscriptionClaim({ request_id: req2, action: 'approve' });
    expect(approveRes.success).toBe(true);

    const rejectAfterApprove = await processSubscriptionClaim({
      request_id: req2,
      action: 'reject',
      reject_reason: 'Too late',
    });
    expect(rejectAfterApprove.success).toBe(false);
    if (!rejectAfterApprove.success) {
      expect(rejectAfterApprove.error.code).toBe('ALREADY_PROCESSED');
      expect(rejectAfterApprove.error.message).toBe('This request has already been approved.');
    }
  });

  it('4. Reject reason validation: >500 chars rejected with no DB change, empty uses default, whitespace trimmed', async () => {
    const { businessId, ownerUserId } = await createBusinessWithOwner(
      '29DDDDD4444D1Z5',
      'Reject Reason Corp',
      'owner4@test.dev',
      'free',
      'expired',
      null,
    );

    const req1 = await insertOne(
      pg,
      `INSERT INTO subscription_requests (
        business_id, user_id, plan_name, billing_cycle, amount_paise,
        payment_method, payment_reference, status
      ) VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', 'UTR_REJECT_001', 'pending') RETURNING id`,
      [businessId, ownerUserId],
    );

    const failLong = await processSubscriptionClaim({
      request_id: req1,
      action: 'reject',
      reject_reason: 'x'.repeat(501),
    });
    expect(failLong.success).toBe(false);

    const checkPending = await pg.query<RequestRow>('SELECT * FROM subscription_requests WHERE id = $1', [req1]);
    expect(checkPending.rows[0]?.status).toBe('pending');

    const okTrimmed = await processSubscriptionClaim({
      request_id: req1,
      action: 'reject',
      reject_reason: '   Payment screenshot unreadable.   ',
    });
    expect(okTrimmed.success).toBe(true);

    const checkTrimmed = await pg.query<RequestRow>('SELECT * FROM subscription_requests WHERE id = $1', [req1]);
    expect(checkTrimmed.rows[0]?.reject_reason).toBe('Payment screenshot unreadable.');

    const req2 = await insertOne(
      pg,
      `INSERT INTO subscription_requests (
        business_id, user_id, plan_name, billing_cycle, amount_paise,
        payment_method, payment_reference, status
      ) VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', 'UTR_REJECT_002', 'pending') RETURNING id`,
      [businessId, ownerUserId],
    );

    const okDefault = await processSubscriptionClaim({
      request_id: req2,
      action: 'reject',
    });
    expect(okDefault.success).toBe(true);

    const checkDefault = await pg.query<RequestRow>('SELECT * FROM subscription_requests WHERE id = $1', [req2]);
    expect(checkDefault.rows[0]?.reject_reason).toBe('Verification failed. Please check details.');
  });

  it('5. Unknown request id returns REQUEST_NOT_FOUND, and unsupported billing cycle returns INVALID_BILLING_CYCLE', async () => {
    const unknownId = 'a0000000-0000-4000-8000-000000000999';
    const notFoundRes = await processSubscriptionClaim({
      request_id: unknownId,
      action: 'approve',
    });
    expect(notFoundRes.success).toBe(false);
    if (!notFoundRes.success) {
      expect(notFoundRes.error.code).toBe('REQUEST_NOT_FOUND');
    }

    const { businessId, ownerUserId } = await createBusinessWithOwner(
      '29EEEEE5555E1Z5',
      'Weird Cycle Corp',
      'owner5@test.dev',
      'free',
      'expired',
      null,
    );

    const weirdReqId = await insertOne(
      pg,
      `INSERT INTO subscription_requests (
        business_id, user_id, plan_name, billing_cycle, amount_paise,
        payment_method, payment_reference, status
      ) VALUES ($1, $2, 'essentials', 'manual_override', 39900, 'upi_qr', 'UTR_WEIRD_001', 'pending') RETURNING id`,
      [businessId, ownerUserId],
    );

    const weirdRes = await processSubscriptionClaim({
      request_id: weirdReqId,
      action: 'approve',
    });
    expect(weirdRes.success).toBe(false);
    if (!weirdRes.success) {
      expect(weirdRes.error.code).toBe('INVALID_BILLING_CYCLE');
    }

    const reqCheck = await pg.query<RequestRow>('SELECT * FROM subscription_requests WHERE id = $1', [weirdReqId]);
    expect(reqCheck.rows[0]?.status).toBe('pending');
  });

  it('6. Manual override: updates business, writes audit log with previous values, attributes ledger row to owner with MANUAL-<uuid>, and enforces rollback on coherence/owner errors', async () => {
    const { businessId, ownerUserId } = await createBusinessWithOwner(
      '29FFFFF6666F1Z5',
      'Override Target Corp',
      'owner6@test.dev',
      'free',
      'expired',
      null,
    );

    const futureExpiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const overrideRes = await updateBusinessSubscription({
      business_id: businessId,
      subscription_plan: 'professional',
      subscription_status: 'active',
      subscription_ends_at: futureExpiry,
    });

    expect(overrideRes.success).toBe(true);

    const bizRows = await pg.query<BusinessRow>('SELECT * FROM businesses WHERE id = $1', [businessId]);
    const biz = bizRows.rows[0];
    if (!biz) throw new Error('Business not found');
    expect(biz.subscription_plan).toBe('professional');
    expect(biz.subscription_status).toBe('active');

    const auditRows = await pg.query<AuditRow>(
      `SELECT * FROM audit_log WHERE business_id = $1 AND action = 'subscription_manual_override' ORDER BY created_at DESC LIMIT 1`,
      [businessId],
    );
    expect(auditRows.rows.length).toBe(1);
    const audit = auditRows.rows[0];
    if (!audit) throw new Error('Audit row not found');
    expect(audit.user_id).toBe(ADMIN_USER_ID);

    const metadata = audit.metadata as Record<string, unknown>;
    expect(metadata.updated_by).toBe(ADMIN_EMAIL);
    expect(metadata.previous).toEqual({
      subscription_plan: 'free',
      subscription_status: 'expired',
      subscription_ends_at: null,
    });

    const ledgerRows = await pg.query<RequestRow>(
      `SELECT * FROM subscription_requests WHERE business_id = $1 AND billing_cycle = 'manual_override' ORDER BY created_at DESC LIMIT 1`,
      [businessId],
    );
    expect(ledgerRows.rows.length).toBe(1);
    const ledger = ledgerRows.rows[0];
    if (!ledger) throw new Error('Ledger row not found');
    expect(ledger.user_id).toBe(ownerUserId);
    expect(ledger.user_id).not.toBe(ADMIN_USER_ID);
    expect(ledger.status).toBe('approved');
    expect(ledger.payment_reference).toMatch(/^MANUAL-[0-9a-f-]{36}$/);

    const parallelOverrides = Array.from({ length: 20 }, () =>
      updateBusinessSubscription({
        business_id: businessId,
        subscription_plan: 'essentials',
        subscription_status: 'active',
        subscription_ends_at: futureExpiry,
      }),
    );
    const parallelResults = await Promise.all(parallelOverrides);
    for (const r of parallelResults) {
      expect(r.success).toBe(true);
    }

    const multiLedger = await pg.query<RequestRow>(
      `SELECT payment_reference FROM subscription_requests WHERE business_id = $1 AND billing_cycle = 'manual_override'`,
      [businessId],
    );
    const refSet = new Set(multiLedger.rows.map((r) => r.payment_reference));
    expect(refSet.size).toBe(21);

    const incoherents = [
      {
        plan: 'free' as const,
        status: 'active' as const,
        date: futureExpiry,
        expectedCode: 'INVALID_OVERRIDE',
      },
      {
        plan: 'essentials' as const,
        status: 'active' as const,
        date: new Date(Date.now() - 1000).toISOString(),
        expectedCode: 'INVALID_OVERRIDE',
      },
    ];

    for (const inc of incoherents) {
      const failRes = await updateBusinessSubscription({
        business_id: businessId,
        subscription_plan: inc.plan,
        subscription_status: inc.status,
        subscription_ends_at: inc.date,
      });
      expect(failRes.success).toBe(false);
      if (!failRes.success) {
        expect(failRes.error.code).toBe(inc.expectedCode);
      }
    }

    const unknownBizRes = await updateBusinessSubscription({
      business_id: 'a0000000-0000-4000-8000-000000000999',
      subscription_plan: 'essentials',
      subscription_status: 'active',
      subscription_ends_at: futureExpiry,
    });
    expect(unknownBizRes.success).toBe(false);
    if (!unknownBizRes.success) {
      expect(unknownBizRes.error.code).toBe('BUSINESS_NOT_FOUND');
    }

    const noOwnerBizId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status
      ) VALUES ('No Owner Biz', '29GGGGG7777G1Z5', '789 Rd', 'Bengaluru', '29', '560001', 'free', 'expired') RETURNING id`,
    );

    const noOwnerRes = await updateBusinessSubscription({
      business_id: noOwnerBizId,
      subscription_plan: 'essentials',
      subscription_status: 'active',
      subscription_ends_at: futureExpiry,
    });
    expect(noOwnerRes.success).toBe(false);
    if (!noOwnerRes.success) {
      expect(noOwnerRes.error.code).toBe('OWNER_NOT_FOUND');
    }

    const noOwnerBizCheck = await pg.query<BusinessRow>('SELECT * FROM businesses WHERE id = $1', [noOwnerBizId]);
    expect(noOwnerBizCheck.rows[0]?.subscription_status).toBe('expired');
  });

  it('7. Claim submission: single pending claim enforced, Promise.all duplicate race handled, cross-tenant UTR returns neutral message, and new claim allowed after approval', async () => {
    const { businessId: bizA, ownerUserId: userA } = await createBusinessWithOwner(
      '29HHHHH8888H1Z5',
      'Tenant A Corp',
      'tenantA@test.dev',
      'free',
      'expired',
      null,
    );

    const { businessId: bizB, ownerUserId: userB } = await createBusinessWithOwner(
      '29IIIII9999I1Z5',
      'Tenant B Corp',
      'tenantB@test.dev',
      'free',
      'expired',
      null,
    );

    state.sessionUserEmail = 'tenantA@test.dev';
    state.userId = userA;
    state.businessId = bizA;

    const claim1 = await submitPaymentClaim({
      plan_name: 'essentials',
      billing_cycle: 'monthly',
      payment_method: 'upi_qr',
      payment_reference: 'UTR-TENANT-A-001',
    });
    expect(claim1.success).toBe(true);

    const claim2 = await submitPaymentClaim({
      plan_name: 'essentials',
      billing_cycle: 'monthly',
      payment_method: 'upi_qr',
      payment_reference: 'UTR-TENANT-A-002',
    });
    expect(claim2.success).toBe(false);
    if (!claim2.success) {
      expect(claim2.error.code).toBe('PENDING_CLAIM_EXISTS');
      expect(claim2.error.message).toBe(
        'You already have a payment verification request pending. Please wait for our team to review it.',
      );
    }

    state.sessionUserEmail = 'tenantB@test.dev';
    state.userId = userB;
    state.businessId = bizB;

    const [parallel1, parallel2] = await Promise.all([
      submitPaymentClaim({
        plan_name: 'essentials',
        billing_cycle: 'monthly',
        payment_method: 'upi_qr',
        payment_reference: 'UTR-PARALLEL-B1',
      }),
      submitPaymentClaim({
        plan_name: 'essentials',
        billing_cycle: 'monthly',
        payment_method: 'upi_qr',
        payment_reference: 'UTR-PARALLEL-B2',
      }),
    ]);

    const successes = [parallel1, parallel2].filter((r) => r.success);
    const failures = [parallel1, parallel2].filter((r) => !r.success);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    const failClaim = failures[0];
    if (failClaim && !failClaim.success) {
      expect(failClaim.error.code).toBe('PENDING_CLAIM_EXISTS');
    }

    state.sessionUserEmail = ADMIN_EMAIL;
    state.userId = ADMIN_USER_ID;
    state.businessId = null;

    const bPending = await pg.query<RequestRow>(
      `SELECT * FROM subscription_requests WHERE business_id = $1 AND status = 'pending'`,
      [bizB],
    );
    expect(bPending.rows.length).toBe(1);
    const bReqId = bPending.rows[0]?.id;
    if (!bReqId) throw new Error('No pending claim for Tenant B');

    await processSubscriptionClaim({ request_id: bReqId, action: 'approve' });

    state.sessionUserEmail = 'tenantB@test.dev';
    state.userId = userB;
    state.businessId = bizB;

    const duplicateCrossTenant = await submitPaymentClaim({
      plan_name: 'essentials',
      billing_cycle: 'monthly',
      payment_method: 'upi_qr',
      payment_reference: 'UTR-TENANT-A-001',
    });
    expect(duplicateCrossTenant.success).toBe(false);
    if (!duplicateCrossTenant.success) {
      expect(duplicateCrossTenant.error.code).toBe('DUPLICATE_REFERENCE');
      expect(duplicateCrossTenant.error.message).toBe(
        'This payment reference could not be accepted. Please double-check the UTR/transaction ID; if it is correct, contact support and quote it.',
      );
      expect(duplicateCrossTenant.error.message).not.toContain('already been submitted');
    }

    const freshClaimAfterApprove = await submitPaymentClaim({
      plan_name: 'essentials',
      billing_cycle: 'yearly',
      payment_method: 'bank_transfer',
      payment_reference: 'UTR-TENANT-B-FRESH',
    });
    expect(freshClaimAfterApprove.success).toBe(true);
  });
});
