import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/lib/db/schema';

/**
 * Feature C (notifications) against a real Postgres engine (PGlite) with every migration applied:
 * who is told what, never twice, the daily job, the e-mail queue (claim / retry / give up / skip), and the
 * person-scoped actions. A fixed clock makes every date-based reminder deterministic.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: '',
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
vi.mock('@/lib/auth/request-session', () => ({
  // GET /api/notifications reads the session; map it to the signed-in test user's auth id.
  getRequestSession: async () => {
    if (!state.userId) return null;
    const { eq } = await import('drizzle-orm');
    const { users } = await import('@/lib/db/schema');
    const database = state.db as ReturnType<typeof drizzle<typeof schema>>;
    const [row] = await database.select({ auth: users.auth_user_id }).from(users).where(eq(users.id, state.userId)).limit(1);
    return row ? { data: { user: { id: row.auth } } } : null;
  },
}));
vi.mock('@/lib/auth/server', () => ({
  auth: { getSession: async () => ({ data: { user: { id: 'auth-id', email: 'x@test.dev', emailVerified: true } } }) },
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  defaultActionLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: () => undefined, logWarn: () => undefined }));
vi.mock('@/lib/email/mailer', () => ({
  getMailer: () => {
    throw new Error('tests inject their own sender');
  },
}));
vi.mock('@/lib/env', () => ({
  getAppEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://test.app' }),
  getEmailEnv: () => ({ EMAIL_FROM: 'noreply@test.app' }),
  getContactEnv: () => ({}),
  getAdminEnv: () => ({ PLATFORM_ADMIN_EMAILS: [], PLATFORM_ADMIN_USER_IDS: [] }),
}));

import { db } from '@/lib/db/client';
import { DAILY_RUN_MARKER_KEY, runDailyNotifications } from '@/lib/notifications/daily';
import { deliverNotificationEmails, type OutgoingEmail } from '@/lib/notifications/deliver';
import { notify } from '@/lib/notifications/notify';
import { gstReturnDueDraft, invoicesOverdueDraft, paymentApprovedDraft } from '@/lib/notifications/messages';
import { GET as getNotificationsRoute } from '@/app/api/notifications/route';
import { markNotificationsRead } from '@/lib/actions/notifications/mark-notifications-read';
import {
  getNotificationSettings,
  saveNotificationPreferences,
} from '@/lib/actions/notifications/notification-settings';
import { saveGstFilingFrequency } from '@/lib/actions/notifications/save-gst-filing-frequency';

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

/** 8 Dec 2026, 09:30 IST. Yesterday = 7 Dec, +3 days = 11 Dec (the monthly GSTR-1 due date for November). */
const NOW = new Date('2026-12-08T04:00:00Z');

interface Sent {
  readonly to: string;
  readonly subject: string;
  readonly titles: string[];
}

describe('Feature C: notifications (PGlite)', () => {
  let pg: PGlite;
  let seq = 0;
  let sent: Sent[] = [];
  let failSends = false;

  const sender = async (email: OutgoingEmail): Promise<boolean> => {
    if (failSends) return false;
    const props = email.react.props as { items: { title: string }[] };
    sent.push({ to: email.to, subject: email.subject, titles: props.items.map((item) => item.title) });
    return true;
  };

  beforeAll(async () => {
    pg = new PGlite();
    for (const tag of readJournalTags()) {
      const statements = readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const statement of statements) await pg.exec(statement);
    }
    state.db = drizzle(pg, { schema });
  }, 120_000);

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    sent = [];
    failSends = false;
    // Isolation: financial records cannot be deleted (immutability guards), so earlier tests' businesses are parked
    // as suspended (the daily job skips them) and their notifications removed; each test asserts on its own business.
    await pg.exec(`
      UPDATE businesses SET subscription_status = 'suspended' WHERE subscription_status <> 'suspended';
      DELETE FROM notifications;
      DELETE FROM platform_settings WHERE key = '${DAILY_RUN_MARKER_KEY}';
    `);
  });

  /** BUG-01: the last IST day the daily job finished ("YYYY-MM-DD"), or null. */
  async function lastRun(): Promise<string | null> {
    const result = await pg.query<{ date: string | null }>(
      `SELECT value->>'date' AS date FROM platform_settings WHERE key = $1`,
      [DAILY_RUN_MARKER_KEY],
    );
    return result.rows[0]?.date ?? null;
  }

  async function setLastRun(date: string): Promise<void> {
    await pg.query(
      `INSERT INTO platform_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [DAILY_RUN_MARKER_KEY, JSON.stringify({ date })],
    );
  }

  async function one(sqlText: string, params: unknown[]): Promise<string> {
    const result = await pg.query<{ id: string }>(sqlText, params);
    const row = result.rows[0];
    if (!row) throw new Error(`no row for ${sqlText}`);
    return row.id;
  }

  async function createBusiness(options: {
    status?: 'trial' | 'active' | 'expired' | 'suspended';
    plan?: 'trial' | 'essentials' | 'professional' | 'free';
    trialEndsAt?: string | null;
    subscriptionEndsAt?: string | null;
    frequency?: 'monthly' | 'quarterly' | 'not_filing' | null;
    registration?: 'regular' | 'composition';
    stateCode?: string;
  } = {}): Promise<string> {
    seq += 1;
    return one(
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode, registration_type,
         subscription_plan, subscription_status, trial_ends_at, subscription_ends_at, gst_filing_frequency)
       VALUES ($1, $2, 'Main St', 'Bengaluru', $3, '560001', $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        `Notify Biz ${seq}`,
        `29ABCDE${String(1000 + seq).slice(-4)}F1Z5`,
        options.stateCode ?? '29',
        options.registration ?? 'regular',
        options.plan ?? 'essentials',
        options.status ?? 'active',
        options.trialEndsAt ?? null,
        options.subscriptionEndsAt ?? '2027-06-01T00:00:00Z',
        options.frequency === undefined ? 'monthly' : options.frequency,
      ],
    );
  }

  async function createUser(
    businessId: string | null,
    role: 'owner' | 'staff' | 'accountant',
    options: { email?: string | null; prefs?: Record<string, unknown> } = {},
  ): Promise<string> {
    seq += 1;
    return one(
      `INSERT INTO users (auth_user_id, email, business_id, role, display_name, notification_prefs)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        `auth_${seq}`,
        options.email === undefined ? `${role}${seq}@biz.test` : options.email,
        businessId,
        role,
        `${role} ${seq}`,
        JSON.stringify(options.prefs ?? {}),
      ],
    );
  }

  async function createInvoice(
    businessId: string,
    data: { number: string; dueDate: string; totalPaise: number; paymentStatus?: string },
  ): Promise<string> {
    seq += 1;
    const fy = await pg.query<{ id: string }>('SELECT id FROM financial_years WHERE business_id = $1', [businessId]);
    const fyId =
      fy.rows[0]?.id ??
      (await one(
        `INSERT INTO financial_years (business_id, label, start_date, end_date)
         VALUES ($1, '2026-27', '2026-04-01', '2027-03-31') RETURNING id`,
        [businessId],
      ));
    return one(
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, invoice_sequence, lifecycle_status,
         payment_status, invoice_date, due_date, grand_total_paise, subtotal_paise, total_tax_paise, finalized_at,
         seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_snapshot_source)
       VALUES ($1, $2, $3, $4, 'finalized', $5, '2026-11-01', $6, $7, $7, 0, now(), 'Seller',
         $8, '29', 'captured_at_finalization') RETURNING id`,
      [
        businessId,
        fyId,
        data.number,
        seq,
        data.paymentStatus ?? 'unpaid',
        data.dueDate,
        data.totalPaise,
        JSON.stringify({ line1: '1 Road', city: 'Bengaluru', pincode: '560001' }),
      ],
    );
  }

  async function bell(): Promise<{ status: number; unreadCount: number; titles: string[]; ids: string[] }> {
    const response = await getNotificationsRoute();
    const body = (await response.json()) as { unreadCount?: number; items?: { id: string; title: string }[] };
    return {
      status: response.status,
      unreadCount: body.unreadCount ?? -1,
      titles: (body.items ?? []).map((item) => item.title),
      ids: (body.items ?? []).map((item) => item.id),
    };
  }

  async function rows(businessId: string) {
    const result = await pg.query<{
      id: string;
      user_id: string;
      kind: string;
      title: string;
      body: string;
      urgent: boolean;
      email_state: string;
      email_attempts: number;
      read_at: Date | null;
    }>(
      `SELECT id, user_id, kind, title, body, urgent, email_state, email_attempts, read_at
       FROM notifications WHERE business_id = $1 ORDER BY kind, user_id`,
      [businessId],
    );
    return result.rows;
  }

  it('the daily job tells each role only its categories, with correct money, GST and trial reminders', async () => {
    const biz = await createBusiness({ status: 'trial', plan: 'trial', trialEndsAt: '2026-12-11T06:00:00Z' });
    const owner = await createUser(biz, 'owner');
    const staff = await createUser(biz, 'staff');
    const ca = await createUser(biz, 'accountant');

    // Became overdue today (due yesterday): unpaid ₹1,000 + partially paid ₹500 of ₹800 left = ₹1,300.
    await createInvoice(biz, { number: 'INV/1', dueDate: '2026-12-07', totalPaise: 100_000 });
    const partial = await createInvoice(biz, { number: 'INV/2', dueDate: '2026-12-07', totalPaise: 80_000, paymentStatus: 'partially_paid' });
    await pg.query(
      `INSERT INTO payments (business_id, invoice_id, amount_paise, payment_date, payment_method, status)
       VALUES ($1, $2, 50000, '2026-12-01', 'upi', 'active')`,
      [biz, partial],
    );
    // Paid and older-overdue invoices are NOT "became overdue today".
    await createInvoice(biz, { number: 'INV/3', dueDate: '2026-12-07', totalPaise: 70_000, paymentStatus: 'paid' });
    await createInvoice(biz, { number: 'INV/4', dueDate: '2026-12-01', totalPaise: 70_000 });
    // Due in 3 days.
    await createInvoice(biz, { number: 'INV/5', dueDate: '2026-12-11', totalPaise: 25_000 });

    const summary = await runDailyNotifications({ now: NOW, send: sender });
    expect(summary.businessErrors).toBe(0);

    const all = await rows(biz);
    const byKind = (kind: string) => all.filter((row) => row.kind === kind).map((row) => row.user_id).sort();

    expect(byKind('invoices_overdue')).toEqual([owner, staff, ca].sort());
    expect(byKind('invoices_due_soon')).toEqual([owner, staff, ca].sort());
    expect(byKind('gst_return_due')).toEqual([owner, ca].sort()); // never staff
    expect(byKind('trial_ending')).toEqual([owner]); // plan items: owner only
    expect(all.find((row) => row.kind === 'invoices_overdue')?.title).toBe('2 invoices became overdue today');
    expect(all.find((row) => row.kind === 'invoices_overdue')?.body).toContain('₹1,300');
    expect(all.find((row) => row.kind === 'invoices_due_soon')?.body).toContain('₹250');
    expect(all.find((row) => row.kind === 'gst_return_due')?.title).toBe('GSTR-1 for November 2026 is due on 11 Dec 2026');
    expect(all.find((row) => row.kind === 'trial_ending')?.title).toBe('Your free trial ends in 3 days');

    // One daily summary e-mail per person, listing that person's items.
    expect(sent.map((email) => email.to).sort()).toHaveLength(3);
    const ownerMail = sent.find((email) => email.titles.includes('Your free trial ends in 3 days'));
    expect(ownerMail?.titles).toHaveLength(4);
    expect(ownerMail?.subject).toMatch(/^4 things need your attention — Notify Biz \d+$/);
    expect(all.every((row) => row.email_state === 'sent')).toBe(true);

    // Running again the same day adds nothing and sends nothing.
    sent = [];
    const again = await runDailyNotifications({ now: NOW, send: sender });
    expect(again.created).toBe(0);
    expect(sent).toEqual([]);
    expect(await rows(biz)).toHaveLength(all.length);
  });

  it('respects e-mail choices: digest off, a category off, and no address all skip the e-mail but keep the bell item', async () => {
    const biz = await createBusiness({ frequency: 'not_filing' });
    await createUser(biz, 'owner', { prefs: { digest: 'off' } });
    await createUser(biz, 'staff', { prefs: { email: { money: false } } });
    await createUser(biz, 'accountant', { email: null });
    await createInvoice(biz, { number: 'INV/9', dueDate: '2026-12-07', totalPaise: 10_000 });

    await runDailyNotifications({ now: NOW, send: sender });
    const all = await rows(biz);
    expect(all.map((row) => row.kind)).toEqual(['invoices_overdue', 'invoices_overdue', 'invoices_overdue']);
    expect(all.every((row) => row.email_state === 'skipped')).toBe(true);
    expect(sent).toEqual([]);
  });

  it('GST: missing frequency nudges the owner only; composition and suspended businesses get no GST items', async () => {
    const unset = await createBusiness({ frequency: null });
    const owner = await createUser(unset, 'owner');
    await createUser(unset, 'accountant');
    const composition = await createBusiness({ frequency: null, registration: 'composition' });
    await createUser(composition, 'owner');
    const suspended = await createBusiness({ status: 'suspended', frequency: null });
    await createUser(suspended, 'owner');

    await runDailyNotifications({ now: NOW, send: sender });
    expect((await rows(unset)).map((row) => [row.kind, row.user_id])).toEqual([['gst_frequency_missing', owner]]);
    expect(await rows(composition)).toEqual([]);
    expect(await rows(suspended)).toEqual([]);
  });

  it('quarterly filers in Karnataka get GSTR-3B on the 22nd, in Delhi on the 24th', async () => {
    const karnataka = await createBusiness({ frequency: 'quarterly', stateCode: '29' });
    await createUser(karnataka, 'owner');
    const delhi = await createBusiness({ frequency: 'quarterly', stateCode: '07' });
    await createUser(delhi, 'owner');

    await runDailyNotifications({ now: new Date('2027-01-19T04:00:00Z'), send: sender }); // +3 = 22 Jan
    expect((await rows(karnataka)).map((row) => row.title)).toEqual(['GSTR-3B for Oct–Dec 2026 is due on 22 Jan 2027']);
    expect(await rows(delhi)).toEqual([]);

    await runDailyNotifications({ now: new Date('2027-01-21T04:00:00Z'), send: sender }); // +3 = 24 Jan
    expect((await rows(delhi)).map((row) => row.title)).toEqual(['GSTR-3B for Oct–Dec 2026 is due on 24 Jan 2027']);
  });

  it('BUG-01: the first run ever covers today only and records the day; a normal next day covers that day only', async () => {
    const biz = await createBusiness({ frequency: 'not_filing' });
    await createUser(biz, 'owner');
    await createInvoice(biz, { number: 'OLD/1', dueDate: '2026-12-01', totalPaise: 10_000 }); // overdue since 2 Dec

    expect(await lastRun()).toBeNull();
    const first = await runDailyNotifications({ now: NOW, send: sender });
    expect(first.days).toEqual(['2026-12-08']);
    expect(await rows(biz)).toEqual([]); // no flood of old reminders on the very first run
    expect(await lastRun()).toBe('2026-12-08');

    const next = await runDailyNotifications({ now: new Date('2026-12-09T04:00:00Z'), send: sender });
    expect(next.days).toEqual(['2026-12-09']);
    expect(await lastRun()).toBe('2026-12-09');
  });

  it('BUG-01: after two missed days the run creates their reminders once, worded for today; a re-run adds nothing', async () => {
    const biz = await createBusiness({ frequency: 'not_filing' });
    const owner = await createUser(biz, 'owner');
    await setLastRun('2026-12-05'); // the job last finished on 5 Dec; 6 and 7 Dec were missed; today is 8 Dec

    await createInvoice(biz, { number: 'D/04', dueDate: '2026-12-04', totalPaise: 40_000 }); // told on 5 Dec already
    await createInvoice(biz, { number: 'D/05', dueDate: '2026-12-05', totalPaise: 10_000 }); // overdue on 6 Dec
    await createInvoice(biz, { number: 'D/06', dueDate: '2026-12-06', totalPaise: 20_000 }); // overdue on 7 Dec
    await createInvoice(biz, { number: 'D/07', dueDate: '2026-12-07', totalPaise: 30_000 }); // overdue today
    await createInvoice(biz, { number: 'D/08', dueDate: '2026-12-08', totalPaise: 80_000 }); // due today: no item
    await createInvoice(biz, { number: 'D/09', dueDate: '2026-12-09', totalPaise: 90_000 }); // "due soon" on 6 Dec
    await createInvoice(biz, { number: 'D/10', dueDate: '2026-12-10', totalPaise: 11_000 }); // "due soon" on 7 Dec
    await createInvoice(biz, { number: 'D/11', dueDate: '2026-12-11', totalPaise: 12_000 }); // "due soon" today

    const summary = await runDailyNotifications({ now: NOW, send: sender });
    expect(summary.days).toEqual(['2026-12-06', '2026-12-07', '2026-12-08']);
    expect(summary.businessErrors).toBe(0);

    const all = await rows(biz);
    expect(all.every((row) => row.user_id === owner)).toBe(true);
    expect(all.filter((row) => row.kind === 'invoices_overdue').map((row) => [row.title, row.body.slice(0, 4)])).toEqual(
      expect.arrayContaining([
        ['1 invoice became overdue on 6 Dec 2026', '₹100'],
        ['1 invoice became overdue on 7 Dec 2026', '₹200'],
        ['1 invoice became overdue today', '₹300'],
      ]),
    );
    expect(all.filter((row) => row.kind === 'invoices_overdue')).toHaveLength(3);
    expect(all.filter((row) => row.kind === 'invoices_due_soon').map((row) => row.title).sort()).toEqual([
      '1 invoice due in 2 days',
      '1 invoice due in 3 days',
      '1 invoice due tomorrow',
    ]);
    expect(all.find((row) => row.title === '1 invoice due tomorrow')?.body).toContain('₹900');
    expect(all.map((row) => row.body).join(' ')).not.toContain('₹400'); // 5 Dec was handled by its own run
    expect(all.map((row) => row.body).join(' ')).not.toContain('₹800'); // due today is neither overdue nor "soon"
    expect(await lastRun()).toBe('2026-12-08');

    // The daily summary e-mail lists all six items once.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.titles).toHaveLength(6);

    sent = [];
    const again = await runDailyNotifications({ now: NOW, send: sender });
    expect(again.days).toEqual(['2026-12-08']);
    expect(again.created).toBe(0);
    expect(sent).toEqual([]);

    // Even if the record were lost or rewound, the same days never tell anyone twice.
    await setLastRun('2026-12-05');
    const replay = await runDailyNotifications({ now: NOW, send: sender });
    expect(replay.days).toHaveLength(3);
    expect(replay.created).toBe(0);
    expect(await rows(biz)).toHaveLength(6);
  });

  it('BUG-01: a long outage catches up 7 days at most', async () => {
    const biz = await createBusiness({ frequency: 'not_filing' });
    await createUser(biz, 'owner');
    await setLastRun('2026-11-20');
    await createInvoice(biz, { number: 'L/1', dueDate: '2026-11-30', totalPaise: 10_000 }); // overdue on 1 Dec: too old
    await createInvoice(biz, { number: 'L/2', dueDate: '2026-12-01', totalPaise: 20_000 }); // overdue on 2 Dec: kept

    const summary = await runDailyNotifications({ now: NOW, send: sender });
    expect(summary.days).toEqual([
      '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06', '2026-12-07', '2026-12-08',
    ]);
    expect((await rows(biz)).map((row) => row.title)).toEqual(['1 invoice became overdue on 2 Dec 2026']);
  });

  it('BUG-01: a missed GST reminder is caught up while the due date is ahead, never after it has passed', async () => {
    const early = await createBusiness({ frequency: 'monthly' });
    await createUser(early, 'owner');
    await setLastRun('2026-12-07'); // 8 Dec (GSTR-1 due 11 Dec, 3 days ahead) was missed; today is 9 Dec
    await runDailyNotifications({ now: new Date('2026-12-09T04:00:00Z'), send: sender });
    expect((await rows(early)).map((row) => row.title)).toEqual(['GSTR-1 for November 2026 is due on 11 Dec 2026']);

    await pg.query(`UPDATE businesses SET subscription_status = 'suspended' WHERE id = $1`, [early]);
    const late = await createBusiness({ frequency: 'monthly' });
    await createUser(late, 'owner');
    await setLastRun('2026-12-07'); // 8 Dec missed, but today is 13 Dec: 11 Dec has passed
    const summary = await runDailyNotifications({ now: new Date('2026-12-13T04:00:00Z'), send: sender });
    expect(summary.days[0]).toBe('2026-12-08');
    expect(await rows(late)).toEqual([]);
  });

  it('BUG-01: the 25 March year-end note is caught up when that day was missed', async () => {
    const biz = await createBusiness({ frequency: 'not_filing' });
    await createUser(biz, 'owner');
    await setLastRun('2027-03-24');
    const summary = await runDailyNotifications({ now: new Date('2027-03-27T04:00:00Z'), send: sender });
    expect(summary.days).toEqual(['2027-03-25', '2027-03-26', '2027-03-27']);
    expect(summary.created).toBe(1);
    // Checked on the e-mail: the run's 90-day clean-up uses this test's 2027 date, while the row's created_at is the
    // real date of the test run, so the bell row itself is tidied away at the end of this run.
    expect(sent.map((email) => email.titles)).toEqual([['Financial year 2026-27 ends on 31 March']]);
  });

  it('BUG-01: the last-run record waits while a business fails, then catches up; it never moves backwards', async () => {
    const biz = await createBusiness({ frequency: 'not_filing' });
    await createUser(biz, 'owner');
    await setLastRun('2026-12-05');
    await createInvoice(biz, { number: 'F/1', dueDate: '2026-12-06', totalPaise: 10_000 }); // overdue on 7 Dec

    await pg.exec(`
      CREATE FUNCTION bug01_fail_notify() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated failure'; END $$;
      CREATE TRIGGER bug01_fail_notify BEFORE INSERT ON notifications
        FOR EACH ROW WHEN (NEW.business_id = '${biz}'::uuid) EXECUTE FUNCTION bug01_fail_notify();
    `);
    try {
      const failed = await runDailyNotifications({ now: NOW, send: sender });
      expect(failed.businessErrors).toBe(1);
      expect(await lastRun()).toBe('2026-12-05'); // not advanced: the next run retries these days
    } finally {
      await pg.exec('DROP TRIGGER bug01_fail_notify ON notifications; DROP FUNCTION bug01_fail_notify();');
    }

    const retried = await runDailyNotifications({ now: NOW, send: sender });
    expect(retried.days).toEqual(['2026-12-06', '2026-12-07', '2026-12-08']);
    expect((await rows(biz)).map((row) => row.title)).toEqual(['1 invoice became overdue on 7 Dec 2026']);
    expect(await lastRun()).toBe('2026-12-08');

    // A run for an earlier day (e.g. one that started late) never rewinds the record.
    const older = await runDailyNotifications({ now: new Date('2026-12-03T04:00:00Z'), send: sender });
    expect(older.days).toEqual(['2026-12-03']);
    expect(await lastRun()).toBe('2026-12-08');
  });

  it('BUG-01: a business failing on the first run ever still leaves a retry point for that day', async () => {
    const biz = await createBusiness({ frequency: 'not_filing' });
    await createUser(biz, 'owner');
    await createInvoice(biz, { number: 'R/1', dueDate: '2026-12-07', totalPaise: 10_000 }); // overdue on 8 Dec
    expect(await lastRun()).toBeNull();

    await pg.exec(`
      CREATE FUNCTION bug01_fail_first() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated failure'; END $$;
      CREATE TRIGGER bug01_fail_first BEFORE INSERT ON notifications
        FOR EACH ROW WHEN (NEW.business_id = '${biz}'::uuid) EXECUTE FUNCTION bug01_fail_first();
    `);
    try {
      const failed = await runDailyNotifications({ now: NOW, send: sender });
      expect(failed.businessErrors).toBe(1);
      expect(await lastRun()).toBe('2026-12-07'); // 8 Dec is not marked finished
    } finally {
      await pg.exec('DROP TRIGGER bug01_fail_first ON notifications; DROP FUNCTION bug01_fail_first();');
    }

    const next = await runDailyNotifications({ now: new Date('2026-12-09T04:00:00Z'), send: sender });
    expect(next.days).toEqual(['2026-12-08', '2026-12-09']);
    expect((await rows(biz)).map((row) => row.title)).toEqual(['1 invoice became overdue on 8 Dec 2026']);
    expect(await lastRun()).toBe('2026-12-09');
  });

  it('BUG-01: an unreadable last-run record is replaced, so catch-up works again from the next day', async () => {
    await pg.query(
      `INSERT INTO platform_settings (key, value) VALUES ($1, '{"date":"garbage"}'::jsonb)`,
      [DAILY_RUN_MARKER_KEY],
    );
    const run = await runDailyNotifications({ now: NOW, send: sender });
    expect(run.days).toEqual(['2026-12-08']); // unreadable → today only
    expect(await lastRun()).toBe('2026-12-08'); // "garbage" sorts after any date but is still replaced

    await pg.query(`UPDATE platform_settings SET value = '{"other":1}'::jsonb WHERE key = $1`, [DAILY_RUN_MARKER_KEY]);
    await runDailyNotifications({ now: NOW, send: sender });
    expect(await lastRun()).toBe('2026-12-08'); // a record without a date is replaced too
  });

  it('plan expiring tomorrow is urgent and e-mailed on its own; the PDF-failure item reaches the owner', async () => {
    const biz = await createBusiness({ frequency: 'not_filing', subscriptionEndsAt: '2026-12-09T10:00:00Z' });
    const owner = await createUser(biz, 'owner');
    await createUser(biz, 'staff');
    const invoice = await createInvoice(biz, { number: 'INV/PDF', dueDate: '2027-01-30', totalPaise: 1_000 });
    await pg.query(`UPDATE invoices SET archival_status = 'failed', archival_attempts = 5 WHERE id = $1`, [invoice]);

    await runDailyNotifications({ now: NOW, send: sender });
    const all = await rows(biz);
    expect(all.map((row) => [row.kind, row.user_id, row.urgent])).toEqual([
      ['pdf_archival_failed', owner, false],
      ['plan_expiring', owner, true],
    ]);
    expect(all.find((row) => row.kind === 'plan_expiring')?.title).toBe('Your Essentials Pro plan expires tomorrow');
    // Urgent: its own e-mail with its own subject; the routine item goes in the summary.
    expect(sent.map((email) => email.subject).sort()).toEqual([
      expect.stringMatching(/^1 thing needs your attention — /),
      expect.stringMatching(/^Your Essentials Pro plan expires tomorrow — /),
    ]);
  });

  it('notify is idempotent per person and event; explicit recipients must belong to the business', async () => {
    const biz = await createBusiness();
    const owner = await createUser(biz, 'owner');
    const other = await createBusiness();
    const outsider = await createUser(other, 'owner');

    const draft = gstReturnDueDraft({ returnName: 'GSTR-1', periodLabel: 'November 2026', periodKey: '2026-11', dueDateIso: '2026-12-11' });
    expect((await notify(db, { businessId: biz, draft })).created).toBe(1);
    expect((await notify(db, { businessId: biz, draft })).created).toBe(0);
    expect((await notify(db, { businessId: biz, draft: invoicesOverdueDraft('2026-12-08', 1, 100), recipientUserIds: [outsider] })).created).toBe(0);
    expect((await rows(biz)).map((row) => row.user_id)).toEqual([owner]);

    // The database refuses a duplicate even if code forgot to use ON CONFLICT, and external links.
    await expect(
      pg.query(
        `INSERT INTO notifications (business_id, user_id, kind, category, title, body, dedupe_key)
         VALUES ($1, $2, 'gst_return_due', 'gst', 't', 'b', 'gst:GSTR-1:2026-11')`,
        [biz, owner],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pg.query(
        `INSERT INTO notifications (business_id, user_id, kind, category, title, body, dedupe_key, link)
         VALUES ($1, $2, 'gst_return_due', 'gst', 't', 'b', 'x', '//evil.example')`,
        [biz, owner],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('e-mail queue: a failed send retries, gives up after 3 tries, and someone who left is skipped', async () => {
    const biz = await createBusiness();
    const owner = await createUser(biz, 'owner');
    const urgent = await notify(db, {
      businessId: biz,
      draft: paymentApprovedDraft('req-1', 'essentials', new Date('2027-01-08T00:00:00Z'), () => '8 Jan 2027'),
    });
    expect(urgent.emailNowIds).toHaveLength(1);

    failSends = true;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await deliverNotificationEmails({ ids: urgent.emailNowIds, send: sender });
      const [row] = await rows(biz);
      expect(row?.email_attempts).toBe(attempt);
      expect(row?.email_state).toBe(attempt < 3 ? 'pending' : 'failed');
    }
    failSends = false;
    const nothing = await deliverNotificationEmails({ send: sender });
    expect(nothing.claimed).toBe(0); // 'failed' is final

    // Left the business before the e-mail went out -> skipped, never sent.
    await notify(db, { businessId: biz, draft: invoicesOverdueDraft('2026-12-08', 1, 100) });
    await pg.query('UPDATE users SET business_id = NULL WHERE id = $1', [owner]);
    const result = await deliverNotificationEmails({ send: sender });
    expect(result.skipped).toBe(1);
    expect(sent).toEqual([]);
  });

  it('actions only ever see and change the signed-in person\'s own items and choices', async () => {
    const biz = await createBusiness();
    const owner = await createUser(biz, 'owner');
    const staff = await createUser(biz, 'staff');
    await notify(db, { businessId: biz, draft: invoicesOverdueDraft('2026-12-08', 1, 100) });
    await notify(db, { businessId: biz, draft: invoicesOverdueDraft('2026-12-09', 2, 200) });
    const staffRow = (await rows(biz)).find((row) => row.user_id === staff);
    if (!staffRow) throw new Error('missing staff row');

    state.userId = '';
    expect((await bell()).status).toBe(401); // signed out

    state.userId = owner;
    const list = await bell();
    expect(list.status).toBe(200);
    expect(list.unreadCount).toBe(2);
    expect(list.titles).toEqual([
      '2 invoices became overdue today',
      '1 invoice became overdue today',
    ]);

    // The owner cannot mark the staff member's item as read.
    const foreign = await markNotificationsRead({ ids: [staffRow.id] });
    expect(foreign.success && foreign.data.updated).toBe(0);
    const firstId = list.ids[0];
    if (!firstId) throw new Error('no item');
    expect((await markNotificationsRead({ ids: [firstId] })).success).toBe(true);
    expect((await bell()).unreadCount).toBe(1);
    const all = await markNotificationsRead({ all: true });
    expect(all.success && all.data.updated).toBe(1);

    state.userId = staff;
    expect((await bell()).unreadCount).toBe(2); // untouched by the owner

    // Preferences: saved for the caller only, validated strictly.
    const saved = await saveNotificationPreferences({ email: { money: false, gst: true, account: true, team: true }, digest: 'off' });
    expect(saved.success).toBe(true);
    const bad = await saveNotificationPreferences({ email: { money: false }, digest: 'hourly' });
    expect(bad.success).toBe(false);
    const prefs = await pg.query<{ id: string; notification_prefs: unknown }>(
      'SELECT id, notification_prefs FROM users WHERE id IN ($1, $2)',
      [owner, staff],
    );
    expect(prefs.rows.find((row) => row.id === owner)?.notification_prefs).toEqual({});
    expect(prefs.rows.find((row) => row.id === staff)?.notification_prefs).toEqual({
      email: { money: false, gst: true, account: true, team: true },
      digest: 'off',
    });
    const settings = await getNotificationSettings({});
    expect(settings.success && settings.data.categories).toEqual(['money', 'team']);

    // GST frequency: a business setting, owner only, audited.
    const refused = await saveGstFilingFrequency({ frequency: 'quarterly' });
    expect(refused.success).toBe(false);
    if (!refused.success) expect(refused.error.code).toBe('FORBIDDEN_ROLE');
    state.userId = owner;
    expect((await saveGstFilingFrequency({ frequency: 'quarterly' })).success).toBe(true);
    expect((await saveGstFilingFrequency({ frequency: 'quarterly' })).success).toBe(true); // no-op, no second audit
    const audit = await pg.query<{ metadata: { previous: string; new: string } }>(
      "SELECT metadata FROM audit_log WHERE business_id = $1 AND action = 'gst_filing_frequency_change'",
      [biz],
    );
    expect(audit.rows.map((row) => row.metadata)).toEqual([{ previous: 'monthly', new: 'quarterly' }]);
    const ownerSettings = await getNotificationSettings({});
    expect(ownerSettings.success && ownerSettings.data.gst).toEqual({ frequency: 'quarterly', registrationType: 'regular' });
  });
});
