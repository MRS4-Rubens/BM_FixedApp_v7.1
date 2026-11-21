import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import * as planCatalog from '@/lib/subscriptions/plan-catalog';
import { count } from 'drizzle-orm';

const { mockUpload, state } = vi.hoisted(() => {
  const mockUploadFn = vi.fn(async () => {});
  const s = {
    db: undefined as unknown,
    userId: '10000000-0000-4000-8000-000000000001',
    businessId: '20000000-0000-4000-8000-000000000001',
    sessionUserEmail: 'owner@test.dev' as string | null,
    uploadCalled: false,
  };
  return { mockUpload: mockUploadFn, state: s };
});

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
              id: state.userId,
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
  uploadFileToStorage: mockUpload,
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
    PLATFORM_ADMIN_EMAILS: ['admin@test.dev'],
    PLATFORM_ADMIN_USER_IDS: ['a0000000-0000-4000-8000-000000000099'],
  }),
}));

import { submitPaymentClaim } from '@/lib/actions/subscriptions/submit-payment-claim';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

function readJournal(): { tag: string }[] {
  const raw = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'));
  return raw.entries.map((e: { tag: string }) => ({ tag: e.tag }));
}

async function applyMigrations(pg: PGlite, entries: { tag: string }[]): Promise<void> {
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

describe('CLEAN-002: Plan Availability & Payment Claim Guard', () => {
  let pg: PGlite;
  let drizzleDb: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg, readJournal());
    drizzleDb = drizzle(pg, { schema });
    state.db = drizzleDb;
    // Applying every migration to a fresh PGlite takes >10 s under full-suite load; same budget as the other PGlite suites.
  }, 60_000);

  afterAll(async () => {
    await pg?.close();
  });

  beforeEach(async () => {
    mockUpload.mockClear();
    state.uploadCalled = false;
    await drizzleDb.delete(schema.subscriptionRequests);
    await drizzleDb.delete(schema.users);
    await drizzleDb.delete(schema.businesses);

    // Seed test business and user
    await drizzleDb.insert(schema.businesses).values({
      id: state.businessId,
      legal_name: 'Test Business',
      address_line1: '123 Main St',
      city: 'Bengaluru',
      state_code: '29',
      pincode: '560001',
      subscription_plan: 'free',
      subscription_status: 'active',
      gstin: '27AABCB1234A1Z5',
    });

    await drizzleDb.insert(schema.users).values({
      id: state.userId,
      auth_user_id: state.userId,
      business_id: state.businessId,
      display_name: 'Owner User',
      email: state.sessionUserEmail!,
      role: 'owner',
    });
  });

  it('accepts professional plan claim and inserts pending row with correct amount', async () => {
    const res = await submitPaymentClaim({
      plan_name: 'professional' as unknown as 'essentials',
      billing_cycle: 'yearly',
      payment_method: 'upi_id',
      payment_reference: 'UTR123456789012',
    });

    expect(res.success).toBe(true);

    const [rowCount] = await drizzleDb
      .select({ count: count() })
      .from(schema.subscriptionRequests);
    expect(Number(rowCount.count)).toBe(1);

    const [row] = await drizzleDb
      .select()
      .from(schema.subscriptionRequests);
    expect(row?.plan_name).toBe('professional');
    expect(row?.billing_cycle).toBe('yearly');
    expect(row?.amount_paise).toBe(599900);
    expect(row?.status).toBe('pending');
  });

  it('rejects unpurchasable plan claim with PLAN_NOT_AVAILABLE, no storage upload, and no DB insert', async () => {
    vi.spyOn(planCatalog, 'isPurchasablePlan').mockReturnValueOnce(false);
    const res = await submitPaymentClaim({
      plan_name: 'professional',
      billing_cycle: 'yearly',
      payment_method: 'upi_id',
      payment_reference: 'UTR123456789012',
    });

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe('PLAN_NOT_AVAILABLE');
      expect(res.error.message).toContain('This plan is not available.');
    }

    // Storage upload was never called
    expect(mockUpload).not.toHaveBeenCalled();
    expect(state.uploadCalled).toBe(false);

    // Database has 0 subscription requests
    const [rowCount] = await drizzleDb
      .select({ count: count() })
      .from(schema.subscriptionRequests);
    expect(Number(rowCount.count)).toBe(0);
  });

  it('allows purchasable essentials plan claim', async () => {
    const res = await submitPaymentClaim({
      plan_name: 'essentials',
      billing_cycle: 'monthly',
      payment_method: 'upi_id',
      payment_reference: 'UTR123456789099',
    });

    expect(res.success).toBe(true);

    const [rowCount] = await drizzleDb
      .select({ count: count() })
      .from(schema.subscriptionRequests);
    expect(Number(rowCount.count)).toBe(1);
  });
});
