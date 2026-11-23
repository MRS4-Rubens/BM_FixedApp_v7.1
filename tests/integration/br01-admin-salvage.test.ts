import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/lib/db/schema';

/**
 * BR-01 (salvaged from the old codex/admin-billing-workflow branch), admin console only:
 *  1. "Active subscriptions" counts only PAYING businesses (active + paid plan + end date not passed).
 *  2. The monthly claims trend leaves out the ₹0 manual-override rows.
 *  3. A manual override needs a reason; it is saved in admin_note (and the audit log), not in reject_reason.
 */

const ADMIN_EMAIL = 'admin@test.dev';
const ADMIN_USER_ID = 'a0000000-0000-4000-8000-000000000099';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: 'a0000000-0000-4000-8000-000000000099',
  businessId: null as string | null,
}));

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));
vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({ id: state.userId, business_id: state.businessId, role: 'owner' as const }),
}));
vi.mock('@/lib/auth/server', () => ({
  auth: {
    getSession: async () => ({
      data: { user: { id: ADMIN_USER_ID, email: ADMIN_EMAIL, emailVerified: true } },
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
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: () => undefined, logWarn: () => undefined }));
vi.mock('@/lib/env', () => ({
  getAppEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://test.app' }),
  getEmailEnv: () => ({ EMAIL_FROM: 'noreply@test.app' }),
  getAdminEnv: () => ({ PLATFORM_ADMIN_EMAILS: [ADMIN_EMAIL], PLATFORM_ADMIN_USER_IDS: [ADMIN_USER_ID] }),
}));

import { getAdminDashboardStats } from '@/lib/actions/subscriptions/get-admin-dashboard-stats';
import { getBusinessSubscriptions } from '@/lib/actions/subscriptions/get-business-subscriptions';
import { updateBusinessSubscription } from '@/lib/actions/subscriptions/update-business-subscription';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');
const DAY_MS = 24 * 60 * 60 * 1000;

function readJournalTags(): string[] {
  const raw = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  return raw.entries.map((entry) => entry.tag);
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

describe('BR-01: admin console accuracy (salvaged fixes)', () => {
  let pg: PGlite;
  let seq = 0;

  async function createBusiness(
    plan: string,
    status: string,
    endsAt: Date | null,
  ): Promise<{ businessId: string; ownerUserId: string }> {
    seq += 1;
    const gstin = `29AAAAA${String(1000 + seq)}A1Z5`;
    const biz = await pg.query<{ id: string }>(
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode,
         subscription_plan, subscription_status, subscription_ends_at)
       VALUES ($1, $2, '1 Main St', 'Bengaluru', '29', '560001', $3, $4, $5) RETURNING id`,
      [`Biz ${seq}`, gstin, plan, status, endsAt ? endsAt.toISOString() : null],
    );
    const businessId = biz.rows[0]!.id;
    const owner = await pg.query<{ id: string }>(
      `INSERT INTO users (auth_user_id, email, business_id, role) VALUES ($1, $2, $3, 'owner') RETURNING id`,
      [`auth_br01_${seq}`, `owner${seq}@test.dev`, businessId],
    );
    return { businessId, ownerUserId: owner.rows[0]!.id };
  }

  // A fresh database per test: the platform counts must start from zero, and audit_log is append-only (it cannot
  // be emptied between tests).
  beforeEach(async () => {
    state.userId = ADMIN_USER_ID;
    state.businessId = null;
    pg = new PGlite();
    await applyMigrations(pg);
    state.db = drizzle(pg, { schema });
    await pg.query(
      `INSERT INTO users (id, auth_user_id, email, business_id, role) VALUES ($1, 'admin_auth', $2, NULL, 'owner')`,
      [ADMIN_USER_ID, ADMIN_EMAIL],
    );
  }, 60_000);

  afterEach(async () => {
    await pg.close();
  });

  it('1. Active subscriptions counts only paying businesses whose plan has not lapsed', async () => {
    const now = Date.now();
    await createBusiness('essentials', 'active', new Date(now + 30 * DAY_MS)); // counted
    await createBusiness('professional', 'active', null); // counted (no end date)
    await createBusiness('essentials', 'active', new Date(now - DAY_MS)); // lapsed, not yet expired by the job
    await createBusiness('free', 'expired', null); // Free plan
    await createBusiness('trial', 'trial', new Date(now + 5 * DAY_MS)); // trial
    await createBusiness('essentials', 'expired', new Date(now - 10 * DAY_MS));
    // A Free business that still carries status 'active' (raw row; the override rules no longer allow it).
    await createBusiness('free', 'active', null);

    const result = await getAdminDashboardStats({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.totalBusinesses).toBe(7);
    expect(result.data.activeSubscriptions).toBe(2);
  });

  it('2. The monthly claims trend leaves out ₹0 manual overrides; revenue stays the sum of real claims', async () => {
    const { businessId, ownerUserId } = await createBusiness('essentials', 'active', new Date(Date.now() + 30 * DAY_MS));
    await pg.query(
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise,
         payment_method, payment_reference, status, approved_at)
       VALUES ($1, $2, 'essentials', 'monthly', 39900, 'upi_qr', 'UTR_BR01_REAL', 'approved', now())`,
      [businessId, ownerUserId],
    );

    const override = await updateBusinessSubscription({
      business_id: businessId,
      subscription_plan: 'professional',
      subscription_status: 'active',
      subscription_ends_at: new Date(Date.now() + 60 * DAY_MS).toISOString(),
      reason: 'Upgrade for pilot feedback',
    });
    expect(override.success).toBe(true);

    const result = await getAdminDashboardStats({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    const thisMonth = result.data.monthlyRevenue[result.data.monthlyRevenue.length - 1]!;
    expect(thisMonth.claimCount).toBe(1); // the real claim only, not the override
    expect(thisMonth.revenuePaise).toBe(39900);
    expect(result.data.totalRevenuePaise).toBe(39900);
  });

  it('3. A manual override without a reason is refused and changes nothing', async () => {
    const { businessId } = await createBusiness('free', 'expired', null);
    for (const reason of ['', '   ']) {
      const res = await updateBusinessSubscription({
        business_id: businessId,
        subscription_plan: 'essentials',
        subscription_status: 'active',
        subscription_ends_at: new Date(Date.now() + 30 * DAY_MS).toISOString(),
        reason,
      });
      expect(res.success).toBe(false);
    }
    const missing = await updateBusinessSubscription({
      business_id: businessId,
      subscription_plan: 'essentials',
      subscription_status: 'active',
      subscription_ends_at: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    } as never);
    expect(missing.success).toBe(false);

    const biz = await pg.query<{ subscription_plan: string }>('SELECT subscription_plan FROM businesses WHERE id = $1', [businessId]);
    expect(biz.rows[0]?.subscription_plan).toBe('free');
    const rows = await pg.query('SELECT id FROM subscription_requests WHERE business_id = $1', [businessId]);
    expect(rows.rows).toHaveLength(0);
  });

  it('4. The reason is saved in admin_note and the audit log; reject_reason stays empty; the history returns it', async () => {
    const { businessId } = await createBusiness('free', 'expired', null);
    const res = await updateBusinessSubscription({
      business_id: businessId,
      subscription_plan: 'essentials',
      subscription_status: 'active',
      subscription_ends_at: new Date(Date.now() + 30 * DAY_MS).toISOString(),
      reason: '  Free month for pilot feedback  ',
    });
    expect(res.success).toBe(true);

    const ledger = await pg.query<{ admin_note: string | null; reject_reason: string | null; status: string }>(
      `SELECT admin_note, reject_reason, status FROM subscription_requests WHERE business_id = $1`,
      [businessId],
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toEqual({ admin_note: 'Free month for pilot feedback', reject_reason: null, status: 'approved' });

    const audit = await pg.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_log WHERE business_id = $1 AND action = 'subscription_manual_override'`,
      [businessId],
    );
    expect(audit.rows[0]?.metadata.reason).toBe('Free month for pilot feedback');

    const history = await getBusinessSubscriptions({ business_id: businessId });
    expect(history.success).toBe(true);
    if (!history.success) return;
    expect(history.data[0]?.adminNote).toBe('Free month for pilot feedback');
    expect(history.data[0]?.rejectReason).toBeNull();
  });
});
