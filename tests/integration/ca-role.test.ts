import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/lib/db/schema';

/**
 * Feature B1 (read-only accountant / CA role) against a real Postgres engine (PGlite) with every migration applied.
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
  defaultActionLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: () => undefined, logWarn: () => undefined }));
vi.mock('@/lib/email/mailer', () => ({
  getMailer: () => ({
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
  getEmailEnv: () => ({ EMAIL_FROM: 'noreply@test.app' }),
  getContactEnv: () => ({}),
  getAdminEnv: () => ({ PLATFORM_ADMIN_EMAILS: [], PLATFORM_ADMIN_USER_IDS: [] }),
}));

import { inviteTeamMember } from '@/lib/actions/team/invite-team-member';
import { resendTeamInvite } from '@/lib/actions/team/resend-team-invite';
import { removeTeamMember } from '@/lib/actions/team/remove-team-member';
import { acceptTeamInvite } from '@/lib/actions/team/accept-team-invite';
import { getTeam } from '@/lib/actions/team/get-team';
import { changeTeamMemberRole } from '@/lib/actions/team/change-team-member-role';
import { deactivateCustomer } from '@/lib/actions/customers/deactivate-customer';
import { deleteInvoiceDraft } from '@/lib/actions/invoices/delete-invoice-draft';
import { listCustomers } from '@/lib/actions/customers/list-customers';

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

function tokenFromUrl(url: string): string {
  const token = url.split('/invite/')[1];
  if (!token) throw new Error(`no token in ${url}`);
  return token;
}

describe('B1: accountant role (PGlite, all migrations)', () => {
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

  async function inviteAndGetToken(email: string, role: 'staff' | 'accountant' = 'staff'): Promise<{ token: string; invitationId: string }> {
    const result = await inviteTeamMember({ email, role });
    if (!result.success) throw new Error(`invite failed: ${result.error.code}`);
    return { token: tokenFromUrl(result.data.inviteUrl), invitationId: result.data.invitationId };
  }

  async function errorCode(promise: Promise<{ success: boolean; error?: { code?: string } }>): Promise<string> {
    const result = await promise;
    return result.success ? 'OK' : (result.error?.code ?? 'UNKNOWN');
  }

  it('accountant invites need Professional; Essentials and Free are refused', async () => {
    await createBusiness('essentials');
    expect(await errorCode(inviteTeamMember({ email: 'ca@firm.test', role: 'accountant' }))).toBe('ACCOUNTANT_PLAN_REQUIRED');
    expect(await errorCode(inviteTeamMember({ email: 'staff@firm.test', role: 'staff' }))).toBe('OK');

    await createBusiness('professional');
    expect(await errorCode(inviteTeamMember({ email: 'ca@firm.test', role: 'accountant' }))).toBe('OK');
    const team = await getTeam({});
    expect(team.success && team.data.canInviteAccountant).toBe(true);
  });

  it('a CA joins as accountant, can read, and is refused every data change (server-side)', async () => {
    const { businessId } = await createBusiness('professional');
    const { token } = await inviteAndGetToken('ca.join@firm.test', 'accountant');
    const caId = await createUser('ca.join@firm.test', null);
    signIn(caId, 'ca.join@firm.test');
    expect(await errorCode(acceptTeamInvite({ token }))).toBe('OK');

    const row = await pg.query<{ business_id: string; role: string }>('SELECT business_id, role FROM users WHERE id = $1', [caId]);
    expect(row.rows[0]).toEqual({ business_id: businessId, role: 'accountant' });

    // Reads work.
    expect(await errorCode(listCustomers({}))).toBe('OK');
    // Changes are refused before any handler code runs.
    const someId = '00000000-0000-4000-8000-000000000001';
    expect(await errorCode(deactivateCustomer({ id: someId }))).toBe('FORBIDDEN_ROLE');
    expect(await errorCode(deleteInvoiceDraft({ id: someId }))).toBe('FORBIDDEN_ROLE');
    // Owner-only team actions too.
    expect(await errorCode(getTeam({}))).toBe('FORBIDDEN_ROLE');
    expect(await errorCode(inviteTeamMember({ email: 'x@firm.test' }))).toBe('FORBIDDEN_ROLE');
  });

  it('staff can still change data (control for the previous test)', async () => {
    const { businessId } = await createBusiness('professional');
    const staffId = await createUser('staff.ok@firm.test', businessId, 'staff');
    signIn(staffId, 'staff.ok@firm.test');
    // Past the role gate: the handler runs and reports the (random) customer as missing.
    expect(await errorCode(deactivateCustomer({ id: '00000000-0000-4000-8000-000000000002' }))).not.toBe('FORBIDDEN_ROLE');
  });

  it('change role: staff <-> accountant, Professional needed only to MAKE an accountant, audited', async () => {
    const pro = await createBusiness('professional');
    const memberId = await createUser('switch@firm.test', pro.businessId, 'staff');

    const toCa = await changeTeamMemberRole({ user_id: memberId, role: 'accountant' });
    expect(toCa.success && toCa.data.changed).toBe(true);
    const same = await changeTeamMemberRole({ user_id: memberId, role: 'accountant' });
    expect(same.success && same.data.changed).toBe(false); // idempotent
    const audit = await pg.query<{ metadata: { previous_role: string; new_role: string } }>(
      "SELECT metadata FROM audit_log WHERE business_id = $1 AND action = 'member_role_change'",
      [pro.businessId],
    );
    expect(audit.rows.map((r) => [r.metadata.previous_role, r.metadata.new_role])).toEqual([['staff', 'accountant']]);

    // Downgrade: the existing accountant keeps access and can be switched back to staff, but not made an accountant again.
    await pg.query("UPDATE businesses SET subscription_plan = 'essentials' WHERE id = $1", [pro.businessId]);
    expect(await errorCode(changeTeamMemberRole({ user_id: memberId, role: 'staff' }))).toBe('OK');
    expect(await errorCode(changeTeamMemberRole({ user_id: memberId, role: 'accountant' }))).toBe('ACCOUNTANT_PLAN_REQUIRED');

    // Feature C: the member (only) is told about each real change; the no-op and the refused change add nothing.
    const told = await pg.query<{ user_id: string; title: string }>(
      "SELECT user_id, title FROM notifications WHERE business_id = $1 AND kind = 'role_changed' ORDER BY created_at, title",
      [pro.businessId],
    );
    expect(told.rows.map((r) => r.user_id)).toEqual([memberId, memberId]);
    expect(told.rows.map((r) => r.title).sort()).toEqual([
      'Your role was changed to Accountant (read-only)',
      'Your role was changed to Team member',
    ]);

    expect(await errorCode(changeTeamMemberRole({ user_id: pro.ownerId, role: 'staff' }))).toBe('CANNOT_CHANGE_OWN_ROLE');
    const otherOwner = await createUser('co@firm.test', pro.businessId, 'owner');
    expect(await errorCode(changeTeamMemberRole({ user_id: otherOwner, role: 'staff' }))).toBe('CANNOT_CHANGE_OWNER');
    expect(await errorCode(changeTeamMemberRole({ user_id: '00000000-0000-4000-8000-000000000003', role: 'staff' }))).toBe('NOT_FOUND');
  });

  it('after leaving Professional: an existing CA keeps read access, but a pending CA invite cannot be used or resent', async () => {
    const { businessId, ownerId, ownerEmail } = await createBusiness('professional');
    const existingCa = await createUser('ca.existing@firm.test', businessId, 'accountant');
    const pending = await inviteAndGetToken('ca.pending@firm.test', 'accountant');
    await pg.query("UPDATE business_invitations SET updated_at = now() - interval '5 minutes' WHERE id = $1", [pending.invitationId]);
    await pg.query("UPDATE businesses SET subscription_plan = 'essentials' WHERE id = $1", [businessId]);

    expect(await errorCode(resendTeamInvite({ invitation_id: pending.invitationId }))).toBe('ACCOUNTANT_PLAN_REQUIRED');

    signIn(existingCa, 'ca.existing@firm.test');
    expect(await errorCode(listCustomers({}))).toBe('OK');

    signIn(await createUser('ca.pending@firm.test', null), 'ca.pending@firm.test');
    expect(await errorCode(acceptTeamInvite({ token: pending.token }))).toBe('ACCOUNTANT_PLAN_REQUIRED');

    signIn(ownerId, ownerEmail);
  });

  it('the owner can remove an accountant like any team member', async () => {
    const { businessId } = await createBusiness('professional');
    const caId = await createUser('ca.leave@firm.test', businessId, 'accountant');
    expect(await errorCode(removeTeamMember({ user_id: caId }))).toBe('OK');
    const row = await pg.query<{ business_id: string | null; role: string }>('SELECT business_id, role FROM users WHERE id = $1', [caId]);
    expect(row.rows[0]).toEqual({ business_id: null, role: 'owner' });
  });

  it('the database accepts the accountant role in users and invitations, never owner invites', async () => {
    const { businessId, ownerId } = await createBusiness('professional');
    await expect(createUser('db.ca@firm.test', businessId, 'accountant')).resolves.toBeTruthy();
    await expect(
      pg.query(
        `INSERT INTO business_invitations (business_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, 'db.inv@firm.test', 'accountant', md5(random()::text), $2, now() + interval '1 day')`,
        [businessId, ownerId],
      ),
    ).resolves.toBeTruthy();
    await expect(
      pg.query(
        `INSERT INTO business_invitations (business_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, 'db.own@firm.test', 'owner', md5(random()::text), $2, now() + interval '1 day')`,
        [businessId, ownerId],
      ),
    ).rejects.toThrow(/business_invitations_role_valid/);
  });
});
