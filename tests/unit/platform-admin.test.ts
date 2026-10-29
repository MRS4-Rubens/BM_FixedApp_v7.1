import { describe, expect, it } from 'vitest';
import {
  evaluatePlatformAdmin,
  type PlatformAdminAllowlist,
} from '@/lib/auth/admin-policy';

describe('evaluatePlatformAdmin (AUTH-001)', () => {
  const defaultAllow: PlatformAdminAllowlist = {
    userIds: ['usr_admin_001', 'usr_admin_002'],
    emails: ['admin@billmatrix.in', 'super@billmatrix.in'],
  };

  it('rejects null, undefined, or missing/empty user id with no_session', () => {
    expect(evaluatePlatformAdmin(null, defaultAllow)).toEqual({
      allowed: false,
      reason: 'no_session',
    });
    expect(evaluatePlatformAdmin(undefined, defaultAllow)).toEqual({
      allowed: false,
      reason: 'no_session',
    });
    expect(evaluatePlatformAdmin({}, defaultAllow)).toEqual({
      allowed: false,
      reason: 'no_session',
    });
    expect(evaluatePlatformAdmin({ id: '' }, defaultAllow)).toEqual({
      allowed: false,
      reason: 'no_session',
    });
    expect(evaluatePlatformAdmin({ id: 123 }, defaultAllow)).toEqual({
      allowed: false,
      reason: 'no_session',
    });
  });

  it('authorizes id in userIds via user_id even if emailVerified is false, missing, or falsy', () => {
    const unverifiedUser = {
      id: 'usr_admin_001',
      email: 'other@example.com',
      emailVerified: false,
    };
    expect(evaluatePlatformAdmin(unverifiedUser, defaultAllow)).toEqual({
      allowed: true,
      identity: {
        id: 'usr_admin_001',
        email: 'other@example.com',
        via: 'user_id',
      },
    });

    const noEmailUser = {
      id: 'usr_admin_002',
    };
    expect(evaluatePlatformAdmin(noEmailUser, defaultAllow)).toEqual({
      allowed: true,
      identity: {
        id: 'usr_admin_002',
        email: '',
        via: 'user_id',
      },
    });
  });

  it('authorizes verified email match (case and whitespace insensitive) via verified_email', () => {
    const user = {
      id: 'usr_regular_001',
      email: '  Admin@BillMatrix.IN  ',
      emailVerified: true,
    };
    expect(evaluatePlatformAdmin(user, defaultAllow)).toEqual({
      allowed: true,
      identity: {
        id: 'usr_regular_001',
        email: 'admin@billmatrix.in',
        via: 'verified_email',
      },
    });
  });

  it('rejects allow-listed email with emailVerified false, undefined, string "true", or 1 with email_unverified', () => {
    const cases = [false, undefined, 'true', 1, null, 0, {}];
    for (const val of cases) {
      const user = {
        id: 'usr_regular_002',
        email: 'admin@billmatrix.in',
        emailVerified: val,
      };
      expect(evaluatePlatformAdmin(user, defaultAllow)).toEqual({
        allowed: false,
        reason: 'email_unverified',
      });
    }
  });

  it('rejects verified email that is not in the allow-list with not_allowlisted', () => {
    const user = {
      id: 'usr_regular_003',
      email: 'stranger@example.com',
      emailVerified: true,
    };
    expect(evaluatePlatformAdmin(user, defaultAllow)).toEqual({
      allowed: false,
      reason: 'not_allowlisted',
    });
  });

  it('rejects any user when allowlists are empty with not_allowlisted', () => {
    const emptyAllow: PlatformAdminAllowlist = { userIds: [], emails: [] };
    const user = {
      id: 'usr_admin_001',
      email: 'admin@billmatrix.in',
      emailVerified: true,
    };
    expect(evaluatePlatformAdmin(user, emptyAllow)).toEqual({
      allowed: false,
      reason: 'not_allowlisted',
    });
  });

  it('does NOT authorize a user whose ID equals an allow-listed email (separate namespaces)', () => {
    const user = {
      id: 'admin@billmatrix.in',
      email: 'imposter@example.com',
      emailVerified: true,
    };
    expect(evaluatePlatformAdmin(user, defaultAllow)).toEqual({
      allowed: false,
      reason: 'not_allowlisted',
    });
  });

  it('ignores extra session fields completely', () => {
    const user = {
      id: 'usr_admin_001',
      email: 'admin@billmatrix.in',
      emailVerified: true,
      role: 'superadmin',
      extra_metadata: { dangerous: true },
      session_token: 'secret',
    };
    expect(evaluatePlatformAdmin(user, defaultAllow)).toEqual({
      allowed: true,
      identity: {
        id: 'usr_admin_001',
        email: 'admin@billmatrix.in',
        via: 'user_id',
      },
    });
  });
});

