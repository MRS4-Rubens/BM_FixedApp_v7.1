import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/lib/db/schema';

/**
 * Feature A1 (team invites) against a real Postgres engine (PGlite) with every migration applied.
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
import { revokeTeamInvite } from '@/lib/actions/team/revoke-team-invite';
import { removeTeamMember } from '@/lib/actions/team/remove-team-member';
import { acceptTeamInvite } from '@/lib/actions/team/accept-team-invite';
import { getTeam } from '@/lib/actions/team/get-team';
import { hashInviteToken } from '@/lib/team/invite-token';
import { PENDING_INVITE_COOKIE, takePendingInvitePath } from '@/lib/team/pending-invite-cookie';

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

describe('A1: team invites (PGlite, all migrations)', () => {
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

  async function createUser(email: string, businessId: string | null, role: 'owner' | 'staff' = 'owner'): Promise<string> {
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

  async function inviteAndGetToken(email: string): Promise<{ token: string; invitationId: string }> {
    const result = await inviteTeamMember({ email });
    if (!result.success) throw new Error(`invite failed: ${result.error.code}`);
    return { token: tokenFromUrl(result.data.inviteUrl), invitationId: result.data.invitationId };
  }

  async function errorCode(promise: Promise<{ success: boolean; error?: { code?: string } }>): Promise<string> {
    const result = await promise;
    return result.success ? 'OK' : (result.error?.code ?? 'UNKNOWN');
  }

  it('owner invites: stores only the hash, e-mails the link, audits, and returns the link to the owner', async () => {
    const { businessId } = await createBusiness();
    const result = await inviteTeamMember({ email: '  New.Staff@Example.com ' });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.email).toBe('new.staff@example.com');
    expect(result.data.emailSent).toBe(true);
    const token = tokenFromUrl(result.data.inviteUrl);
    expect(state.sentEmails).toEqual([{ to: ['new.staff@example.com'], inviteUrl: `https://test.app/invite/${token}` }]);

    const rows = await pg.query<{ token_hash: string; status: string; role: string }>(
      'SELECT token_hash, status, role FROM business_invitations WHERE business_id = $1',
      [businessId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.token_hash).toBe(hashInviteToken(token));
    expect(rows.rows[0]?.token_hash).not.toContain(token);
    expect(rows.rows[0]).toMatchObject({ status: 'pending', role: 'staff' });

    const audit = await pg.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE business_id = $1 AND entity_type = 'team'",
      [businessId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['invite_create']);
  });

  it('keeps the invite when the e-mail fails, so the owner can share the link', async () => {
    await createBusiness();
    state.failEmail = true;
    const result = await inviteTeamMember({ email: 'mailfail@example.com' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.emailSent).toBe(false);
      expect(result.data.inviteUrl).toMatch(/^https:\/\/test\.app\/invite\/[A-Za-z0-9_-]{43}$/);
    }
  });

  it('refuses duplicate, self and existing-member invites', async () => {
    const { businessId, ownerEmail } = await createBusiness();
    await inviteAndGetToken('dup@example.com');
    expect(await errorCode(inviteTeamMember({ email: 'DUP@example.com' }))).toBe('ALREADY_INVITED');
    expect(await errorCode(inviteTeamMember({ email: ownerEmail.toUpperCase() }))).toBe('CANNOT_INVITE_SELF');
    await createUser('already@example.com', businessId, 'staff');
    expect(await errorCode(inviteTeamMember({ email: 'already@example.com' }))).toBe('ALREADY_MEMBER');
  });

  it('enforces seats: Essentials = owner + 2, open invites hold seats, cancelling frees one', async () => {
    await createBusiness('essentials');
    const first = await inviteAndGetToken('s1@example.com');
    await inviteAndGetToken('s2@example.com');
    expect(await errorCode(inviteTeamMember({ email: 's3@example.com' }))).toBe('TEAM_SEAT_LIMIT');

    expect(await errorCode(revokeTeamInvite({ invitation_id: first.invitationId }))).toBe('OK');
    expect(await errorCode(revokeTeamInvite({ invitation_id: first.invitationId }))).toBe('OK'); // idempotent
    expect(await errorCode(inviteTeamMember({ email: 's3@example.com' }))).toBe('OK');
  });

  it('free plan cannot invite; Professional is unlimited', async () => {
    await createBusiness('free');
    expect(await errorCode(inviteTeamMember({ email: 'x@example.com' }))).toBe('TEAM_PLAN_REQUIRED');

    await createBusiness('professional');
    for (let i = 0; i < 5; i += 1) {
      expect(await errorCode(inviteTeamMember({ email: `pro${i}@example.com` }))).toBe('OK');
    }
  });

  it('staff cannot use any owner team action', async () => {
    const { businessId } = await createBusiness();
    const { invitationId } = await inviteAndGetToken('target@example.com');
    const staffId = await createUser('staffer@example.com', businessId, 'staff');
    signIn(staffId, 'staffer@example.com');
    expect(await errorCode(inviteTeamMember({ email: 'z@example.com' }))).toBe('FORBIDDEN_ROLE');
    expect(await errorCode(resendTeamInvite({ invitation_id: invitationId }))).toBe('FORBIDDEN_ROLE');
    expect(await errorCode(revokeTeamInvite({ invitation_id: invitationId }))).toBe('FORBIDDEN_ROLE');
    expect(await errorCode(removeTeamMember({ user_id: staffId }))).toBe('FORBIDDEN_ROLE');
    expect(await errorCode(getTeam({}))).toBe('FORBIDDEN_ROLE');
  });

  it('accept: the invited, verified, business-less account joins as staff; the link then stops working', async () => {
    const { businessId, ownerId } = await createBusiness();
    const { token, invitationId } = await inviteAndGetToken('joiner@example.com');
    const joinerId = await createUser('joiner@example.com', null);
    signIn(joinerId, 'Joiner@Example.com');

    const result = await acceptTeamInvite({ token });
    expect(result.success).toBe(true);

    const user = await pg.query<{ business_id: string; role: string }>('SELECT business_id, role FROM users WHERE id = $1', [joinerId]);
    expect(user.rows[0]).toEqual({ business_id: businessId, role: 'staff' });
    const invite = await pg.query<{ status: string; accepted_by: string }>(
      'SELECT status, accepted_by FROM business_invitations WHERE id = $1',
      [invitationId],
    );
    expect(invite.rows[0]).toEqual({ status: 'accepted', accepted_by: joinerId });
    const audit = await pg.query<{ entity_id: string }>(
      "SELECT entity_id FROM audit_log WHERE business_id = $1 AND action = 'member_join'",
      [businessId],
    );
    expect(audit.rows.map((r) => r.entity_id)).toEqual([joinerId]);

    // Feature C: the owner (not the joiner) is told who joined; routine, so it waits for the daily summary e-mail.
    const told = await pg.query<{ user_id: string; kind: string; urgent: boolean; email_state: string; title: string }>(
      'SELECT user_id, kind, urgent, email_state, title FROM notifications WHERE business_id = $1',
      [businessId],
    );
    expect(told.rows).toEqual([
      { user_id: ownerId, kind: 'member_joined', urgent: false, email_state: 'pending', title: expect.stringMatching(/ joined your business$/) },
    ]);

    expect(await errorCode(acceptTeamInvite({ token }))).toBe('ALREADY_MEMBER');
    const otherId = await createUser('joiner2@example.com', null);
    signIn(otherId, 'joiner@example.com');
    expect(await errorCode(acceptTeamInvite({ token }))).toBe('INVITE_USED');
  });

  it('accept refuses wrong e-mail, unverified e-mail, an account with a business, bad tokens', async () => {
    await createBusiness();
    const { token } = await inviteAndGetToken('right@example.com');

    const wrongId = await createUser('wrong@example.com', null);
    signIn(wrongId, 'wrong@example.com');
    expect(await errorCode(acceptTeamInvite({ token }))).toBe('EMAIL_MISMATCH');

    const rightId = await createUser('right@example.com', null);
    signIn(rightId, 'right@example.com', false);
    expect(await errorCode(acceptTeamInvite({ token }))).toBe('EMAIL_NOT_VERIFIED');

    const other = await createBusiness();
    await pg.query('UPDATE users SET business_id = $1 WHERE id = $2', [other.businessId, rightId]);
    signIn(rightId, 'right@example.com');
    expect(await errorCode(acceptTeamInvite({ token }))).toBe('ALREADY_IN_BUSINESS');

    expect(await errorCode(acceptTeamInvite({ token: 'A'.repeat(43) }))).toBe('INVITE_NOT_FOUND');
    expect(await errorCode(acceptTeamInvite({ token: 'short' }))).toBe('VALIDATION_ERROR');
  });

  it('accept refuses expired and cancelled invites', async () => {
    await createBusiness();
    const expired = await inviteAndGetToken('late@example.com');
    const cancelled = await inviteAndGetToken('gone@example.com');
    await revokeTeamInvite({ invitation_id: cancelled.invitationId });
    await pg.query("UPDATE business_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1", [expired.invitationId]);

    signIn(await createUser('late@example.com', null), 'late@example.com');
    expect(await errorCode(acceptTeamInvite({ token: expired.token }))).toBe('INVITE_EXPIRED');
    signIn(await createUser('gone@example.com', null), 'gone@example.com');
    expect(await errorCode(acceptTeamInvite({ token: cancelled.token }))).toBe('INVITE_REVOKED');
  });

  it('a plan downgrade after the invite blocks the join (nobody is removed)', async () => {
    const { businessId } = await createBusiness('essentials');
    const { token } = await inviteAndGetToken('downgraded@example.com');
    await pg.query("UPDATE businesses SET subscription_plan = 'free', subscription_status = 'expired' WHERE id = $1", [businessId]);

    signIn(await createUser('downgraded@example.com', null), 'downgraded@example.com');
    expect(await errorCode(acceptTeamInvite({ token }))).toBe('TEAM_PLAN_REQUIRED');
  });

  it('two accepts of the same invite at once: exactly one joins', async () => {
    await createBusiness();
    const { token } = await inviteAndGetToken('race@example.com');
    signIn(await createUser('race@example.com', null), 'race@example.com');
    const results = await Promise.all([acceptTeamInvite({ token }), acceptTeamInvite({ token })]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
  });

  it('resend rotates the token (old link dies), restarts the window, and has a cooldown', async () => {
    await createBusiness();
    const { token: oldToken, invitationId } = await inviteAndGetToken('resend@example.com');
    await pg.query("UPDATE business_invitations SET updated_at = now() - interval '5 minutes' WHERE id = $1", [invitationId]);

    const resent = await resendTeamInvite({ invitation_id: invitationId });
    expect(resent.success).toBe(true);
    if (!resent.success) return;
    const newToken = tokenFromUrl(resent.data.inviteUrl);
    expect(newToken).not.toBe(oldToken);
    expect(await errorCode(resendTeamInvite({ invitation_id: invitationId }))).toBe('RESEND_COOLDOWN');

    signIn(await createUser('resend@example.com', null), 'resend@example.com');
    expect(await errorCode(acceptTeamInvite({ token: oldToken }))).toBe('INVITE_NOT_FOUND');
    expect(await errorCode(acceptTeamInvite({ token: newToken }))).toBe('OK');
  });

  it('re-inviting after expiry reuses the same row with a new token', async () => {
    const { businessId } = await createBusiness();
    const first = await inviteAndGetToken('again@example.com');
    await pg.query("UPDATE business_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1", [first.invitationId]);
    const second = await inviteAndGetToken('again@example.com');
    expect(second.invitationId).toBe(first.invitationId);
    expect(second.token).not.toBe(first.token);
    const count = await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM business_invitations WHERE business_id = $1', [businessId]);
    expect(count.rows[0]?.n).toBe(1);
  });

  it('remove: unlinks staff (account kept, role reset), never the owner or yourself; access ends at once', async () => {
    const { businessId, ownerId, ownerEmail } = await createBusiness();
    const staffId = await createUser('leaver@example.com', businessId, 'staff');

    expect(await errorCode(removeTeamMember({ user_id: ownerId }))).toBe('CANNOT_REMOVE_SELF');
    const secondOwnerLike = await createUser('coowner@example.com', businessId, 'owner');
    expect(await errorCode(removeTeamMember({ user_id: secondOwnerLike }))).toBe('CANNOT_REMOVE_OWNER');

    expect(await errorCode(removeTeamMember({ user_id: staffId }))).toBe('OK');
    const row = await pg.query<{ business_id: string | null; role: string }>('SELECT business_id, role FROM users WHERE id = $1', [staffId]);
    expect(row.rows[0]).toEqual({ business_id: null, role: 'owner' });
    expect(await errorCode(removeTeamMember({ user_id: staffId }))).toBe('NOT_FOUND');

    // The removed person's next request sees no business.
    signIn(staffId, 'leaver@example.com');
    expect(await errorCode(getTeam({}))).toBe('NO_BUSINESS');
    signIn(ownerId, ownerEmail);
  });

  it('owner cannot touch another business\'s invites or members', async () => {
    const a = await createBusiness();
    const { invitationId } = await inviteAndGetToken('cross@example.com');
    const staffA = await createUser('staffa@example.com', a.businessId, 'staff');
    await createBusiness(); // signs in owner B
    expect(await errorCode(revokeTeamInvite({ invitation_id: invitationId }))).toBe('NOT_FOUND');
    expect(await errorCode(resendTeamInvite({ invitation_id: invitationId }))).toBe('NOT_FOUND');
    expect(await errorCode(removeTeamMember({ user_id: staffA }))).toBe('NOT_FOUND');
  });

  it('getTeam lists members, open/expired invites and seats, never token hashes', async () => {
    const { businessId } = await createBusiness('essentials');
    await createUser('member@example.com', businessId, 'staff');
    const { invitationId } = await inviteAndGetToken('pending@example.com');

    const result = await getTeam({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.members.map((m) => m.role)).toEqual(['owner', 'staff']);
    expect(result.data.members.filter((m) => m.isYou)).toHaveLength(1);
    expect(result.data.invites).toHaveLength(1);
    expect(result.data.invites[0]).toMatchObject({ id: invitationId, email: 'pending@example.com', isExpired: false });
    expect(result.data.seats).toMatchObject({ used: 3, limit: 3, members: 2, openInvites: 1, overLimit: false });
    expect(result.data.canInvite).toBe(false);
    expect(JSON.stringify(result.data)).not.toContain('token');

    await pg.query("UPDATE businesses SET subscription_plan = 'free', subscription_status = 'expired' WHERE id = $1", [businessId]);
    const downgraded = await getTeam({});
    expect(downgraded.success && downgraded.data.seats.overLimit).toBe(true);
  });

  it('remembered invite after login: one-shot, and only while the invite is still open', async () => {
    await createBusiness();
    const open = await inviteAndGetToken('cookie-open@example.com');
    const gone = await inviteAndGetToken('cookie-gone@example.com');
    await revokeTeamInvite({ invitation_id: gone.invitationId });

    state.cookieJar.set(PENDING_INVITE_COOKIE, open.token);
    expect(await takePendingInvitePath()).toBe(`/invite/${open.token}`);
    expect(state.cookieJar.has(PENDING_INVITE_COOKIE)).toBe(false); // consumed
    expect(await takePendingInvitePath()).toBeNull(); // second login goes to the dashboard

    state.cookieJar.set(PENDING_INVITE_COOKIE, gone.token);
    expect(await takePendingInvitePath()).toBeNull(); // cancelled invite never hijacks a login
    expect(state.cookieJar.has(PENDING_INVITE_COOKIE)).toBe(false);

    state.cookieJar.set(PENDING_INVITE_COOKIE, '../../dashboard');
    expect(await takePendingInvitePath()).toBeNull(); // junk is ignored (no open redirect)

    state.cookieJar.set(PENDING_INVITE_COOKIE, open.token);
    signIn(await createUser('cookie-open@example.com', null), 'cookie-open@example.com');
    expect(await errorCode(acceptTeamInvite({ token: open.token }))).toBe('OK');
    expect(state.cookieJar.has(PENDING_INVITE_COOKIE)).toBe(false); // accept clears it too
  });

  it('the database itself rejects malformed invite rows', async () => {
    const { businessId, ownerId } = await createBusiness();
    const insert = (email: string, status: string) =>
      pg.query(
        `INSERT INTO business_invitations (business_id, email, token_hash, status, invited_by, expires_at)
         VALUES ($1, $2, md5(random()::text), $3, $4, now() + interval '1 day')`,
        [businessId, email, status, ownerId],
      );
    await expect(insert('Mixed@Case.com', 'pending')).rejects.toThrow(/business_invitations_email_normalised/);
    await expect(insert('ok@case.com', 'expired')).rejects.toThrow(/business_invitations_status_valid/);
    await expect(insert('ok@case.com', 'accepted')).rejects.toThrow(/business_invitations_accept_fields/);
  });
});
