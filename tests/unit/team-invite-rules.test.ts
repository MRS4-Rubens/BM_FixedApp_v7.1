import { describe, expect, it } from 'vitest';
import { generateInviteToken, hashInviteToken } from '@/lib/team/invite-token';
import {
  INVITE_TTL_DAYS,
  computeInviteExpiry,
  isInviteExpired,
  isWellFormedInviteToken,
  maskEmail,
  normaliseInviteEmail,
} from '@/lib/team/invite-format';
import { evaluateJoin, evaluateNewInvite, seatsUsed } from '@/lib/team/seats';
import { evaluateAccept, type AcceptingUser, type InviteForAccept } from '@/lib/team/accept-rules';
import { inviteTeamMemberSchema, acceptTeamInviteSchema } from '@/lib/validations/team';

const NOW = new Date('2026-11-16T10:00:00.000Z');

describe('invite tokens', () => {
  it('generates unique, well-formed 43-char base64url tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateInviteToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(isWellFormedInviteToken(token)).toBe(true);
  });

  it('hashes deterministically to 64 hex chars and never equals the token', () => {
    const token = generateInviteToken();
    expect(hashInviteToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
    expect(hashInviteToken(token)).not.toBe(token);
  });

  it('rejects malformed tokens before any lookup', () => {
    for (const bad of ['', 'abc', 'a'.repeat(42), 'a'.repeat(44), '../../etc/passwd', `${'a'.repeat(42)}=`, null, 42]) {
      expect(isWellFormedInviteToken(bad)).toBe(false);
    }
  });

  it('expires exactly INVITE_TTL_DAYS later, and the boundary instant counts as expired', () => {
    const expiry = computeInviteExpiry(NOW);
    expect(expiry.getTime() - NOW.getTime()).toBe(INVITE_TTL_DAYS * 86_400_000);
    expect(isInviteExpired(expiry, new Date(expiry.getTime() - 1))).toBe(false);
    expect(isInviteExpired(expiry, expiry)).toBe(true);
  });

  it('normalises and masks e-mail addresses', () => {
    expect(normaliseInviteEmail('  Rahul.Sharma@Gmail.COM ')).toBe('rahul.sharma@gmail.com');
    expect(maskEmail('rahul.sharma@gmail.com')).toBe('ra***@gmail.com');
    expect(maskEmail('a@x.in')).toBe('a***@x.in');
    expect(maskEmail('not-an-email')).toBe('***');
  });
});

describe('invite validation', () => {
  it('trims and lower-cases the e-mail, defaults the role to staff', () => {
    const parsed = inviteTeamMemberSchema.parse({ email: '  Staff@Example.COM ' });
    expect(parsed).toEqual({ email: 'staff@example.com', role: 'staff' });
  });

  it('refuses inviting an owner and invalid e-mails', () => {
    expect(inviteTeamMemberSchema.safeParse({ email: 'x@example.com', role: 'owner' }).success).toBe(false);
    expect(inviteTeamMemberSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(inviteTeamMemberSchema.safeParse({ email: `${'a'.repeat(250)}@x.in` }).success).toBe(false);
  });

  it('accept schema rejects malformed tokens', () => {
    expect(acceptTeamInviteSchema.safeParse({ token: 'short' }).success).toBe(false);
    expect(acceptTeamInviteSchema.safeParse({ token: generateInviteToken() }).success).toBe(true);
  });
});

describe('seat rules', () => {
  it('free plan (limit 1) cannot invite at all', () => {
    const decision = evaluateNewInvite({ members: 1, openInvites: 0, limit: 1 });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('TEAM_PLAN_REQUIRED');
  });

  it('essentials (limit 3) counts members AND open invites', () => {
    expect(evaluateNewInvite({ members: 1, openInvites: 1, limit: 3 }).allowed).toBe(true);
    const full = evaluateNewInvite({ members: 1, openInvites: 2, limit: 3 });
    expect(full.allowed).toBe(false);
    if (!full.allowed) expect(full.code).toBe('TEAM_SEAT_LIMIT');
    expect(seatsUsed({ members: 2, openInvites: 1, limit: 3 })).toBe(3);
  });

  it('unlimited plan always allows', () => {
    expect(evaluateNewInvite({ members: 500, openInvites: 500, limit: null }).allowed).toBe(true);
    expect(evaluateJoin({ members: 500, limit: null }).allowed).toBe(true);
  });

  it('join re-checks members only against the CURRENT limit (downgrade after invite)', () => {
    expect(evaluateJoin({ members: 2, limit: 3 }).allowed).toBe(true);
    expect(evaluateJoin({ members: 3, limit: 3 }).allowed).toBe(false);
    const downgraded = evaluateJoin({ members: 1, limit: 1 });
    expect(downgraded.allowed).toBe(false);
    if (!downgraded.allowed) expect(downgraded.code).toBe('TEAM_PLAN_REQUIRED');
  });
});

describe('accept rules', () => {
  const invite: InviteForAccept = {
    status: 'pending',
    email: 'staff@example.com',
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    businessId: 'biz-1',
    acceptedBy: null,
  };
  const user: AcceptingUser = {
    appUserId: 'user-9',
    businessId: null,
    sessionEmail: 'Staff@Example.com',
    emailVerified: true,
  };
  const code = (i: InviteForAccept, u: AcceptingUser) => {
    const d = evaluateAccept(i, u, NOW);
    return d.ok ? 'OK' : d.code;
  };

  it('accepts a verified, matching, business-less account (e-mail case-insensitive)', () => {
    expect(code(invite, user)).toBe('OK');
  });

  it('refuses revoked, used, expired, mismatched, unverified and already-linked cases', () => {
    expect(code({ ...invite, status: 'revoked' }, user)).toBe('INVITE_REVOKED');
    expect(code({ ...invite, status: 'accepted', acceptedBy: 'someone-else' }, user)).toBe('INVITE_USED');
    expect(code({ ...invite, expiresAt: NOW }, user)).toBe('INVITE_EXPIRED');
    expect(code(invite, { ...user, sessionEmail: 'other@example.com' })).toBe('EMAIL_MISMATCH');
    expect(code(invite, { ...user, sessionEmail: null })).toBe('EMAIL_MISMATCH');
    expect(code(invite, { ...user, emailVerified: false })).toBe('EMAIL_NOT_VERIFIED');
    expect(code(invite, { ...user, businessId: 'biz-2' })).toBe('ALREADY_IN_BUSINESS');
  });

  it('recognises someone who already joined this business', () => {
    expect(code(invite, { ...user, businessId: 'biz-1' })).toBe('ALREADY_MEMBER');
    expect(code({ ...invite, status: 'accepted', acceptedBy: 'user-9' }, { ...user, businessId: 'biz-1' })).toBe('ALREADY_MEMBER');
  });

  it('checks the e-mail BEFORE verification, so a wrong account is never told to verify', () => {
    expect(code(invite, { ...user, sessionEmail: 'other@example.com', emailVerified: false })).toBe('EMAIL_MISMATCH');
  });
});
