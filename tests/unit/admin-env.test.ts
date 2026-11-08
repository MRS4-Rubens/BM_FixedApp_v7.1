import { describe, expect, it } from 'vitest';
import { adminEnv, checkCoreEnv, type EnvSource } from '@/lib/env';

describe('Admin Environment Validation (AUTH-001)', () => {
  it('parses successfully when only PLATFORM_ADMIN_EMAILS is provided', () => {
    const source: EnvSource = {
      PLATFORM_ADMIN_EMAILS: 'admin@billmatrix.in, super@billmatrix.in',
    };
    const outcome = adminEnv.parse(source);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.PLATFORM_ADMIN_EMAILS).toEqual([
        'admin@billmatrix.in',
        'super@billmatrix.in',
      ]);
      expect(outcome.value.PLATFORM_ADMIN_USER_IDS).toEqual([]);
    }
  });

  it('parses successfully when only PLATFORM_ADMIN_USER_IDS is provided', () => {
    const source: EnvSource = {
      PLATFORM_ADMIN_USER_IDS: 'usr_admin_001, usr_admin_002',
    };
    const outcome = adminEnv.parse(source);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.PLATFORM_ADMIN_USER_IDS).toEqual([
        'usr_admin_001',
        'usr_admin_002',
      ]);
      expect(outcome.value.PLATFORM_ADMIN_EMAILS).toEqual([]);
    }
  });

  it('parses successfully when both emails and user IDs are provided', () => {
    const source: EnvSource = {
      PLATFORM_ADMIN_EMAILS: 'admin@billmatrix.in',
      PLATFORM_ADMIN_USER_IDS: 'usr_admin_001',
    };
    const outcome = adminEnv.parse(source);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.PLATFORM_ADMIN_EMAILS).toEqual(['admin@billmatrix.in']);
      expect(outcome.value.PLATFORM_ADMIN_USER_IDS).toEqual(['usr_admin_001']);
    }
  });

  it('fails with issue naming PLATFORM_ADMIN_USER_IDS when neither is configured', () => {
    const source: EnvSource = {
      PLATFORM_ADMIN_EMAILS: '',
      PLATFORM_ADMIN_USER_IDS: '',
    };
    const outcome = adminEnv.parse(source);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.issues).toHaveLength(1);
      expect(outcome.issues[0]?.group).toBe('admin');
      expect(outcome.issues[0]?.name).toBe('PLATFORM_ADMIN_USER_IDS');
      expect(outcome.issues[0]?.message).toContain('configure at least one administrator');
    }
  });

  it('fails with issue naming PLATFORM_ADMIN_EMAILS on invalid email address', () => {
    const source: EnvSource = {
      PLATFORM_ADMIN_EMAILS: 'not-an-email, valid@billmatrix.in',
    };
    const outcome = adminEnv.parse(source);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.issues.some((i) => i.name === 'PLATFORM_ADMIN_EMAILS')).toBe(true);
      expect(outcome.issues[0]?.message).toBe('contains an invalid e-mail address');
    }
  });

  it('fails with issue naming PLATFORM_ADMIN_USER_IDS when id has spaces or is too short', () => {
    // too short (< 8 chars)
    const tooShort: EnvSource = {
      PLATFORM_ADMIN_USER_IDS: 'usr_1',
    };
    const resShort = adminEnv.parse(tooShort);
    expect(resShort.ok).toBe(false);
    if (!resShort.ok) {
      expect(resShort.issues.some((i) => i.name === 'PLATFORM_ADMIN_USER_IDS')).toBe(true);
      expect(resShort.issues[0]?.message).toBe('contains an invalid user id');
    }

    // id with interior spaces
    const withSpaces: EnvSource = {
      PLATFORM_ADMIN_USER_IDS: 'usr admin 001',
    };
    const resSpaces = adminEnv.parse(withSpaces);
    expect(resSpaces.ok).toBe(false);
    if (!resSpaces.ok) {
      expect(resSpaces.issues.some((i) => i.name === 'PLATFORM_ADMIN_USER_IDS')).toBe(true);
      expect(resSpaces.issues[0]?.message).toBe('contains an invalid user id');
    }
  });

  it('lowercases and trims email addresses and trims user IDs', () => {
    const source: EnvSource = {
      PLATFORM_ADMIN_EMAILS: '  Admin@BillMatrix.IN  ,  SUPER@domain.COM ',
      PLATFORM_ADMIN_USER_IDS: '  usr_admin_001  ,   usr_admin_002 ',
    };
    const outcome = adminEnv.parse(source);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.PLATFORM_ADMIN_EMAILS).toEqual([
        'admin@billmatrix.in',
        'super@domain.com',
      ]);
      expect(outcome.value.PLATFORM_ADMIN_USER_IDS).toEqual([
        'usr_admin_001',
        'usr_admin_002',
      ]);
    }
  });

  it('treats consecutive commas ",," or whitespace-only items as empty and ignores them', () => {
    const source: EnvSource = {
      PLATFORM_ADMIN_EMAILS: ',, admin@billmatrix.in , , ,,',
      PLATFORM_ADMIN_USER_IDS: ' , usr_admin_001 , ,, ',
    };
    const outcome = adminEnv.parse(source);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.PLATFORM_ADMIN_EMAILS).toEqual(['admin@billmatrix.in']);
      expect(outcome.value.PLATFORM_ADMIN_USER_IDS).toEqual(['usr_admin_001']);
    }
  });

  it('leak check: a unique sentinel in an invalid value never appears in JSON.stringify(issues)', () => {
    const sentinelEmail = 'bad_sentinel_xyz123@invalid';
    const sentinelUserId = 'invalid sentinel space #!$';
    const source: EnvSource = {
      PLATFORM_ADMIN_EMAILS: sentinelEmail,
      PLATFORM_ADMIN_USER_IDS: sentinelUserId,
    };
    const outcome = adminEnv.parse(source);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      const serialized = JSON.stringify(outcome.issues);
      expect(serialized).not.toContain(sentinelEmail);
      expect(serialized).not.toContain(sentinelUserId);
      expect(serialized).not.toContain('xyz123');
    }
  });

  it('integrates with checkCoreEnv', () => {
    // When only user IDs configured, admin group produces 0 issues in checkCoreEnv
    const mockEnv: EnvSource = {
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      NEON_AUTH_BASE_URL: 'https://example.neonauth.tech/neondb/auth',
      NEON_AUTH_COOKIE_SECRET: '01234567890123456789012345678901',
      CRON_SECRET: '01234567890123456789012345678901',
      PLATFORM_ADMIN_USER_IDS: 'usr_admin_001',
    };
    const issues = checkCoreEnv(mockEnv);
    const adminIssues = issues.filter((i) => i.group === 'admin');
    expect(adminIssues).toHaveLength(0);
  });
});

