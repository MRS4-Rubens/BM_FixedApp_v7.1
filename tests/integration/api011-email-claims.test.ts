import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import type { DbTransaction } from '@/lib/db/client';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: '00000000-0000-4000-8000-000000000001',
  businessId: null as string | null,
  emailVerified: true as boolean,
  userRole: 'owner',
  sendThrows: false,
  rateLimitAllowed: true,
  rateLimitReason: 'limited' as 'limited' | 'unavailable',
  loggedErrors: [] as Array<{ scope: string; error: unknown; meta?: unknown }>,
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
    role: state.userRole,
  }),
}));

vi.mock('@/lib/auth/server', () => ({
  auth: {
    getSession: async () => ({
      data: {
        user: {
          id: state.userId,
          email: 'user@example.com',
          emailVerified: state.emailVerified,
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

vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: (scope: string, error: unknown, meta?: unknown) => {
    state.loggedErrors.push({ scope, error, meta });
  },
}));

vi.mock('@/lib/storage/idrive', () => ({
  getFileBuffer: async (key: string) => {
    if (key === 'fail-fetch') throw new Error('S3 network timeout');
    return Buffer.from('%PDF-1.4 mock content');
  },
}));

vi.mock('@/lib/email/resend', () => ({
  getResend: () => ({
    emails: {
      send: async () => {
        if (state.sendThrows) {
          return { data: null, error: { name: 'resend_error', message: 'API key revoked' } };
        }
        return { data: { id: 'mock-email-id' }, error: null };
      },
    },
  }),
}));

// LAUNCH-L1: customer e-mails are switched off for the pilot; these tests cover the feature itself, so turn it on.
vi.mock('@/lib/config/features', () => ({ CUSTOMER_EMAILS_ENABLED: true }));

vi.mock('@/lib/env', () => ({
  getEmailEnv: () => ({ RESEND_FROM_EMAIL: 'noreply@test.app' }),
}));

vi.mock('@/lib/rate-limit/enforce', () => ({
  enforceRateLimit: async () => {
    if (!state.rateLimitAllowed) {
      return { allowed: false, reason: state.rateLimitReason, retryAfterSeconds: 3600 };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  },
}));

vi.mock('@/lib/rate-limit/upstash', () => ({
  emailBurstLimiter: {},
  emailDailyCapLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));

import {
  claimInvoiceEmailInTransaction,
  releaseInvoiceEmailClaim,
  claimReminderInTransaction,
  releaseReminderClaim,
} from '@/lib/invoices/email-claim-tx';
import { enforceDailyEmailCap } from '@/lib/email/send-guards';
import { sendPaymentReminder } from '@/lib/actions/invoices/send-payment-reminder';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

interface JournalEntry {
  readonly tag: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJournal(): readonly JournalEntry[] {
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

function statementsOf(tag: string): readonly string[] {
  return readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applyMigrations(pg: PGlite, tags: readonly string[]): Promise<void> {
  for (const tag of tags) {
    for (const stmt of statementsOf(tag)) {
      await pg.exec(stmt);
    }
  }
}

interface IdRow {
  readonly id: string;
}

async function insertOne(pg: PGlite, query: string, params: readonly unknown[] = []): Promise<string> {
  const res = await pg.query<IdRow>(query, params as unknown[]);
  const id = res.rows[0]?.id;
  if (!id) throw new Error(`Query returned no id: ${query}`);
  return id;
}

describe('API-011: Outbound Customer Email Hardening Integration (PGlite)', () => {
  let pg: PGlite;
  let pgliteDb: ReturnType<typeof drizzle<typeof schema>>;
  let businessId: string;
  let foreignBizId: string;
  let fyId: string;
  let foreignFyId: string;
  let validCustomerId: string;
  let foreignCustomerId: string;
  let customerNoEmailId: string;
  let customerInvalidEmailId: string;
  let seqCounter = 1;

  beforeAll(async () => {
    pg = new PGlite();
    const journal = readJournal();
    await applyMigrations(pg, journal.map((j) => j.tag));

    pgliteDb = drizzle(pg, { schema });
    state.db = pgliteDb;

    businessId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        email, phone, subscription_plan, subscription_status
      ) VALUES (
        'Acme Supplies Pvt Ltd', '29ABCDE1234F1Z5', '100 Industrial Area', 'Bengaluru', '29', '560001',
        'billing@acme.test', '9876543210', 'professional', 'active'
      ) RETURNING id`,
    );
    state.businessId = businessId;

    foreignBizId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        email, subscription_plan, subscription_status
      ) VALUES (
        'Foreign Corp', '27XYZAB1234C1Z1', '50 Marine Drive', 'Mumbai', '27', '400001',
        'foreign@corp.test', 'professional', 'active'
      ) RETURNING id`,
    );

    fyId = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true) RETURNING id`,
      [businessId],
    );

    foreignFyId = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true) RETURNING id`,
      [foreignBizId],
    );

    validCustomerId = await insertOne(
      pg,
      `INSERT INTO customers (business_id, name, email, state_code, city, pincode, gstin)
       VALUES ($1, 'Valid Buyer', 'buyer@example.com', '29', 'Bengaluru', '560002', '29XYZAB1234C1Z1') RETURNING id`,
      [businessId],
    );

    foreignCustomerId = await insertOne(
      pg,
      `INSERT INTO customers (business_id, name, email, state_code, city, pincode, gstin)
       VALUES ($1, 'Foreign Buyer', 'foreign.buyer@example.com', '27', 'Mumbai', '400001', '27XYZAB1234C1Z1') RETURNING id`,
      [foreignBizId],
    );

    customerNoEmailId = await insertOne(
      pg,
      `INSERT INTO customers (business_id, name, email, state_code, city, pincode)
       VALUES ($1, 'No Email Buyer', NULL, '29', 'Bengaluru', '560002') RETURNING id`,
      [businessId],
    );

    customerInvalidEmailId = await insertOne(
      pg,
      `INSERT INTO customers (business_id, name, email, state_code, city, pincode)
       VALUES ($1, 'Bad Email Buyer', 'not-a-valid-email', '29', 'Bengaluru', '560002') RETURNING id`,
      [businessId],
    );
  }, 120_000);

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(() => {
    state.sendThrows = false;
    state.rateLimitAllowed = true;
    state.rateLimitReason = 'limited';
    state.emailVerified = true;
    state.loggedErrors = [];
  });

  async function createFinalizedInvoice(options: {
    readonly customerId?: string;
    readonly dueDate?: string;
    readonly paymentStatus?: 'unpaid' | 'paid' | 'partial';
    readonly archivalStatus?: 'archived' | 'pending';
    readonly pdfStorageKey?: string | null;
    readonly invoiceNumber?: string;
    readonly grandTotalPaise?: number;
    readonly bizId?: string;
    readonly targetFyId?: string;
  } = {}): Promise<string> {
    const biz = options.bizId ?? businessId;
    const invNumber = options.invoiceNumber ?? `INV-TEST-${seqCounter}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const custId = options.customerId ?? (biz === foreignBizId ? foreignCustomerId : validCustomerId);
    const useFyId = options.targetFyId ?? (biz === foreignBizId ? foreignFyId : fyId);
    const dueDate = options.dueDate ?? '2026-04-10';
    const payStatus = options.paymentStatus ?? 'unpaid';
    const archStatus = options.archivalStatus ?? 'archived';
    const storageKey = options.pdfStorageKey !== undefined ? options.pdfStorageKey : 'invoices/2026/test.pdf';
    const grandTotal = options.grandTotalPaise ?? 11800;
    const currentSeq = seqCounter++;

    const invId = await insertOne(
      pg,
      `INSERT INTO invoices (
        business_id, customer_id, financial_year_id, invoice_number, lifecycle_status,
        invoice_date, due_date, place_of_supply_state_code, subtotal_paise,
        total_cgst_paise, total_sgst_paise, total_igst_paise, total_tax_paise, grand_total_paise,
        payment_status, archival_status, pdf_storage_key, finalized_at, invoice_sequence,
        seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_snapshot_source, seller_gstin_snapshot
      ) VALUES (
        $1, $2, $3, $4, 'finalized',
        '2026-04-01', $5, '29', $6,
        900, 900, 0, 1800, $6,
        $7, $8, $9, now(), $10,
        'Acme Supplies', '{"city":"Bengaluru"}'::jsonb, '29', 'captured_at_finalization', '29ABCDE1234F1Z5'
      ) RETURNING id`,
      [biz, custId, useFyId, invNumber, dueDate, grandTotal, payStatus, archStatus, storageKey, currentSeq],
    );

    return invId;
  }

  async function runInTx<T>(callback: (tx: DbTransaction) => Promise<T>): Promise<T> {
    return pgliteDb.transaction(async (tx) => {
      return callback(tx as unknown as DbTransaction);
    });
  }

  describe('Case 1: Reminder claim on overdue, unpaid, finalized invoice', () => {
    it('sets reminder_count=1, updates last_reminder_at, leaves emailed_at and email_send_count untouched', async () => {
      const invId = await createFinalizedInvoice({ dueDate: '2026-04-01', paymentStatus: 'unpaid' });
      const now = new Date('2026-05-01T10:00:00Z');

      const claim = await runInTx((tx) =>
        claimReminderInTransaction(tx, { businessId, invoiceId: invId, now }),
      );

      expect(claim.customer.email).toBe('buyer@example.com');
      expect(claim.daysOverdue).toBe(30);

      const check = await pg.query<{
        reminder_count: number;
        last_reminder_at: string;
        emailed_at: string | null;
        email_send_count: number;
      }>(
        `SELECT reminder_count, last_reminder_at, emailed_at, email_send_count FROM invoices WHERE id = $1`,
        [invId],
      );

      expect(check.rows[0]?.reminder_count).toBe(1);
      expect(check.rows[0]?.last_reminder_at).not.toBeNull();
      expect(check.rows[0]?.emailed_at).toBeNull();
      expect(check.rows[0]?.email_send_count).toBe(0);
    });
  });

  describe('Case 2: Reminder cooldown (24h)', () => {
    it('denies second claim within 24h with COOLDOWN; allows claim after 24h and increments count to 2', async () => {
      const invId = await createFinalizedInvoice({ dueDate: '2026-04-01', paymentStatus: 'unpaid' });
      const t1 = new Date('2026-05-01T10:00:00Z');

      await runInTx((tx) =>
        claimReminderInTransaction(tx, { businessId, invoiceId: invId, now: t1 }),
      );

      // 23h 59m later: within cooldown
      const t2 = new Date('2026-05-02T09:59:00Z');
      await expect(
        runInTx((tx) =>
          claimReminderInTransaction(tx, { businessId, invoiceId: invId, now: t2 }),
        ),
      ).rejects.toMatchObject({
        code: 'COOLDOWN',
      });

      // Exactly 24h later: allowed
      const t3 = new Date('2026-05-02T10:00:00Z');
      await runInTx((tx) =>
        claimReminderInTransaction(tx, { businessId, invoiceId: invId, now: t3 }),
      );

      const check = await pg.query<{ reminder_count: number }>(
        `SELECT reminder_count FROM invoices WHERE id = $1`,
        [invId],
      );
      expect(check.rows[0]?.reminder_count).toBe(2);
    });
  });

  describe('Case 3: releaseReminderClaim compensation', () => {
    it('restores previous counter and date; release with mismatched claimedAt is a no-op', async () => {
      const invId = await createFinalizedInvoice({ dueDate: '2026-04-01' });
      const t1 = new Date('2026-05-01T10:00:00Z');

      const claim = await runInTx((tx) =>
        claimReminderInTransaction(tx, { businessId, invoiceId: invId, now: t1 }),
      );

      const checkBeforeRelease = await pg.query<{ reminder_count: number }>(
        `SELECT reminder_count FROM invoices WHERE id = $1`,
        [invId],
      );
      expect(checkBeforeRelease.rows[0]?.reminder_count).toBe(1);

      // Release with mismatched claimedAt
      const staleClaim = { ...claim, claimedAt: new Date('2025-01-01T00:00:00Z') };
      await releaseReminderClaim(pgliteDb as unknown as Pick<DbTransaction, 'update'>, staleClaim);

      const checkAfterStale = await pg.query<{ reminder_count: number }>(
        `SELECT reminder_count FROM invoices WHERE id = $1`,
        [invId],
      );
      expect(checkAfterStale.rows[0]?.reminder_count).toBe(1);

      // Release with matching claim
      await releaseReminderClaim(pgliteDb as unknown as Pick<DbTransaction, 'update'>, claim);

      const checkAfterRelease = await pg.query<{ reminder_count: number; last_reminder_at: string | null }>(
        `SELECT reminder_count, last_reminder_at FROM invoices WHERE id = $1`,
        [invId],
      );
      expect(checkAfterRelease.rows[0]?.reminder_count).toBe(0);
      expect(checkAfterRelease.rows[0]?.last_reminder_at).toBeNull();
    });
  });

  describe('Case 4: Eligibility guards for reminders', () => {
    it('rejects an invoice that is not overdue with NOT_OVERDUE', async () => {
      const invId = await createFinalizedInvoice({ dueDate: '2099-01-01' });
      const now = new Date('2026-05-01T10:00:00Z');
      await expect(
        runInTx((tx) =>
          claimReminderInTransaction(tx, { businessId, invoiceId: invId, now }),
        ),
      ).rejects.toMatchObject({ code: 'NOT_OVERDUE' });
    });

    it('rejects a fully paid invoice with ALREADY_PAID', async () => {
      const invId = await createFinalizedInvoice({ dueDate: '2026-04-01', paymentStatus: 'paid' });
      const now = new Date('2026-05-01T10:00:00Z');
      await expect(
        runInTx((tx) =>
          claimReminderInTransaction(tx, { businessId, invoiceId: invId, now }),
        ),
      ).rejects.toMatchObject({ code: 'ALREADY_PAID' });
    });

    it('rejects an invoice whose balance is fully settled by a credit note with ALREADY_PAID', async () => {
      const invId = await createFinalizedInvoice({
        dueDate: '2026-04-01',
        paymentStatus: 'unpaid',
        grandTotalPaise: 11800,
      });

      // Insert credit note covering 11800 paise
      await insertOne(
        pg,
        `INSERT INTO credit_notes (
          business_id, original_invoice_id, financial_year_id,
          credit_note_number, lifecycle_status, issue_date, credit_note_sequence,
          reason, subtotal_paise, total_tax_paise, grand_total_paise, finalized_at,
          status, seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_snapshot_source, seller_gstin_snapshot
        ) VALUES (
          $1, $2, $3,
          'CN-TEST-001', 'finalized', '2026-04-05', 1,
          'deficiency_in_service', 10000, 1800, 11800, now(),
          'active', 'Acme Supplies', '{"city":"Bengaluru"}'::jsonb, '29', 'captured_at_finalization', '29ABCDE1234F1Z5'
        ) RETURNING id`,
        [businessId, invId, fyId],
      );

      const now = new Date('2026-05-01T10:00:00Z');
      await expect(
        runInTx((tx) =>
          claimReminderInTransaction(tx, { businessId, invoiceId: invId, now }),
        ),
      ).rejects.toMatchObject({ code: 'ALREADY_PAID' });
    });

    it('rejects a draft invoice with INVALID_STATUS', async () => {
      const draftId = await insertOne(
        pg,
        `INSERT INTO invoices (
          business_id, customer_id, financial_year_id, invoice_number, lifecycle_status,
          invoice_date, place_of_supply_state_code, subtotal_paise, total_tax_paise, grand_total_paise
        ) VALUES ($1, $2, $3, 'DRAFT-REMINDER', 'draft', '2026-04-01', '29', 10000, 1800, 11800) RETURNING id`,
        [businessId, validCustomerId, fyId],
      );

      await expect(
        runInTx((tx) =>
          claimReminderInTransaction(tx, { businessId, invoiceId: draftId }),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
    });
  });

  describe('Case 5: Invoice e-mail claim lifecycle', () => {
    it('rejects if PDF is not ready (PDF_NOT_READY); succeeds when archived; cooldown 60s; release restores', async () => {
      const invId = await createFinalizedInvoice({
        archivalStatus: 'pending',
        pdfStorageKey: null,
      });

      // 1. Not archived -> PDF_NOT_READY
      await expect(
        runInTx((tx) =>
          claimInvoiceEmailInTransaction(tx, { businessId, invoiceId: invId }),
        ),
      ).rejects.toMatchObject({ code: 'PDF_NOT_READY' });

      // Update to archived
      await pg.query(
        `UPDATE invoices SET archival_status = 'archived', pdf_storage_key = 'storage/invoice.pdf' WHERE id = $1`,
        [invId],
      );

      const t1 = new Date('2026-05-01T12:00:00Z');
      const claim1 = await runInTx((tx) =>
        claimInvoiceEmailInTransaction(tx, { businessId, invoiceId: invId, now: t1 }),
      );

      expect(claim1.customer.email).toBe('buyer@example.com');
      expect(claim1.pdfStorageKey).toBe('storage/invoice.pdf');

      const check1 = await pg.query<{ email_send_count: number }>(
        `SELECT email_send_count FROM invoices WHERE id = $1`,
        [invId],
      );
      expect(check1.rows[0]?.email_send_count).toBe(1);

      // Immediate repeat within 60s -> COOLDOWN
      const t2 = new Date('2026-05-01T12:00:30Z');
      await expect(
        runInTx((tx) =>
          claimInvoiceEmailInTransaction(tx, { businessId, invoiceId: invId, now: t2 }),
        ),
      ).rejects.toMatchObject({ code: 'COOLDOWN' });

      // After 60s -> ok
      const t3 = new Date('2026-05-01T12:01:05Z');
      const claim2 = await runInTx((tx) =>
        claimInvoiceEmailInTransaction(tx, { businessId, invoiceId: invId, now: t3 }),
      );
      expect(claim2.previousEmailedAt).not.toBeNull();

      const check2 = await pg.query<{ email_send_count: number }>(
        `SELECT email_send_count FROM invoices WHERE id = $1`,
        [invId],
      );
      expect(check2.rows[0]?.email_send_count).toBe(2);

      // Release claim2 restores count=1
      await releaseInvoiceEmailClaim(pgliteDb as unknown as Pick<DbTransaction, 'update'>, claim2);
      const checkReleased = await pg.query<{ email_send_count: number }>(
        `SELECT email_send_count FROM invoices WHERE id = $1`,
        [invId],
      );
      expect(checkReleased.rows[0]?.email_send_count).toBe(1);
    });
  });

  describe('Case 6: Cross-tenant isolation', () => {
    it('returns NOT_FOUND when querying an invoice with the wrong businessId; never returns foreign customer email', async () => {
      const invId = await createFinalizedInvoice({ bizId: foreignBizId });

      await expect(
        runInTx((tx) =>
          claimReminderInTransaction(tx, { businessId, invoiceId: invId }),
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      await expect(
        runInTx((tx) =>
          claimInvoiceEmailInTransaction(tx, { businessId, invoiceId: invId }),
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('Case 7: Customer email validation', () => {
    it('throws NO_CUSTOMER_EMAIL when customer has no email', async () => {
      const invId = await createFinalizedInvoice({ customerId: customerNoEmailId, dueDate: '2026-04-01' });
      const now = new Date('2026-05-01T10:00:00Z');

      await expect(
        runInTx((tx) =>
          claimReminderInTransaction(tx, { businessId, invoiceId: invId, now }),
        ),
      ).rejects.toMatchObject({ code: 'NO_CUSTOMER_EMAIL' });
    });

    it('throws INVALID_CUSTOMER_EMAIL when customer email format is invalid', async () => {
      const invId = await createFinalizedInvoice({ customerId: customerInvalidEmailId, dueDate: '2026-04-01' });
      const now = new Date('2026-05-01T10:00:00Z');

      await expect(
        runInTx((tx) =>
          claimReminderInTransaction(tx, { businessId, invoiceId: invId, now }),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CUSTOMER_EMAIL' });
    });
  });

  describe('Case 8: Trigger compatibility and immutability', () => {
    it('allows updating reminder_count and last_reminder_at on a finalized invoice', async () => {
      const invId = await createFinalizedInvoice();

      await pg.query(
        `UPDATE invoices SET last_reminder_at = now(), reminder_count = reminder_count + 1 WHERE id = $1`,
        [invId],
      );

      const check = await pg.query<{ reminder_count: number }>(
        `SELECT reminder_count FROM invoices WHERE id = $1`,
        [invId],
      );
      expect(check.rows[0]?.reminder_count).toBe(1);
    });

    it('raises BM_IMMUTABLE_RECORD when trying to change grand_total_paise on a finalized invoice', async () => {
      const invId = await createFinalizedInvoice();

      await expect(
        pg.query(`UPDATE invoices SET grand_total_paise = 1 WHERE id = $1`, [invId]),
      ).rejects.toThrow(/BM_IMMUTABLE_RECORD/);
    });

    it('violates invoices_reminder_count_nonneg constraint when setting negative reminder_count', async () => {
      const invId = await createFinalizedInvoice();

      await expect(
        pg.query(`UPDATE invoices SET reminder_count = -1 WHERE id = $1`, [invId]),
      ).rejects.toThrow(/invoices_reminder_count_nonneg/);
    });
  });

  describe('Case 9: Daily cap enforcement unit-level', () => {
    it('throws DAILY_EMAIL_LIMIT when rate-limiter returns limited', async () => {
      state.rateLimitAllowed = false;
      state.rateLimitReason = 'limited';

      await expect(enforceDailyEmailCap(businessId)).rejects.toMatchObject({
        code: 'DAILY_EMAIL_LIMIT',
      });
    });

    it('throws EMAIL_UNAVAILABLE when rate-limiter fails closed (unavailable)', async () => {
      state.rateLimitAllowed = false;
      state.rateLimitReason = 'unavailable';

      await expect(enforceDailyEmailCap(businessId)).rejects.toMatchObject({
        code: 'EMAIL_UNAVAILABLE',
      });

      state.rateLimitAllowed = true;
    });
  });

  describe('Case 10: Action-level execution with external mocks', () => {
    it('releases claim and logs exactly one error when sending fails', async () => {
      state.sendThrows = true;
      state.loggedErrors = [];
      state.emailVerified = true;

      const invId = await createFinalizedInvoice({ dueDate: '2026-04-01' });

      const res = await sendPaymentReminder({ invoiceId: invId });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe('EMAIL_SEND_FAILED');
      }

      // Assert claim was released (reminder_count restored to 0)
      const check = await pg.query<{ reminder_count: number }>(
        `SELECT reminder_count FROM invoices WHERE id = $1`,
        [invId],
      );
      expect(check.rows[0]?.reminder_count).toBe(0);

      // Assert logged error
      const emailErrors = state.loggedErrors.filter((e) => e.scope === 'customer-email');
      expect(emailErrors.length).toBe(1);

      state.sendThrows = false;
    });

    it('blocks unverified non-paid user with EMAIL_NOT_VERIFIED and writes no claim', async () => {
      state.emailVerified = false;

      // Update business to trial tier
      await pg.query(
        `UPDATE businesses SET subscription_plan = 'trial', subscription_status = 'trial', trial_ends_at = '2099-01-01' WHERE id = $1`,
        [businessId],
      );

      const invId = await createFinalizedInvoice({ dueDate: '2026-04-01' });

      const res = await sendPaymentReminder({ invoiceId: invId });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe('EMAIL_NOT_VERIFIED');
      }

      // Assert no claim written
      const check = await pg.query<{ reminder_count: number }>(
        `SELECT reminder_count FROM invoices WHERE id = $1`,
        [invId],
      );
      expect(check.rows[0]?.reminder_count).toBe(0);

      // Restore
      await pg.query(
        `UPDATE businesses SET subscription_plan = 'professional', subscription_status = 'active' WHERE id = $1`,
        [businessId],
      );
      state.emailVerified = true;
    });

    it('blocks suspended business with ACCOUNT_SUSPENDED', async () => {
      await pg.query(
        `UPDATE businesses SET subscription_status = 'suspended' WHERE id = $1`,
        [businessId],
      );

      const invId = await createFinalizedInvoice({ dueDate: '2026-04-01' });

      const res = await sendPaymentReminder({ invoiceId: invId });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe('ACCOUNT_SUSPENDED');
      }

      // Restore
      await pg.query(
        `UPDATE businesses SET subscription_status = 'active' WHERE id = $1`,
        [businessId],
      );
    });
  });
});
