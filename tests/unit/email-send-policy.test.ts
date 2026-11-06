import { describe, expect, it } from 'vitest';
import {
  evaluateCooldown,
  formatRetryAfter,
  evaluateSenderVerification,
  sanitizeEmailHeaderText,
  buildListUnsubscribeHeader,
  computeDaysOverdue,
  REMINDER_COOLDOWN_SECONDS,
} from '@/lib/email/send-policy';

describe('email-send-policy', () => {
  describe('evaluateCooldown', () => {
    it('allows sending when lastAt is null', () => {
      const now = new Date('2026-11-03T10:00:00Z');
      expect(evaluateCooldown(null, now, 60)).toEqual({ allowed: true });
    });

    it('allows sending when exactly at the cooldown boundary', () => {
      const lastAt = new Date('2026-11-03T10:00:00Z');
      const now = new Date('2026-11-03T10:01:00Z'); // exactly 60s later
      expect(evaluateCooldown(lastAt, now, 60)).toEqual({ allowed: true });
    });

    it('allows sending when past the cooldown boundary', () => {
      const lastAt = new Date('2026-11-03T10:00:00Z');
      const now = new Date('2026-11-03T10:01:05Z');
      expect(evaluateCooldown(lastAt, now, 60)).toEqual({ allowed: true });
    });

    it('denies sending 1s before boundary with retryAfterSeconds = 1', () => {
      const lastAt = new Date('2026-11-03T10:00:00Z');
      const now = new Date('2026-11-03T10:00:59Z'); // 1s remaining
      expect(evaluateCooldown(lastAt, now, 60)).toEqual({
        allowed: false,
        retryAfterSeconds: 1,
      });
    });

    it('caps retryAfterSeconds at cooldownSeconds during future clock skew', () => {
      const now = new Date('2026-11-03T10:00:00Z');
      const lastAt = new Date('2026-11-03T10:05:00Z'); // 5 minutes in future
      const decision = evaluateCooldown(lastAt, now, 60);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.retryAfterSeconds).toBe(60);
      }
    });

    it('calculates remaining seconds correctly for 24h reminder cooldown', () => {
      const lastAt = new Date('2026-11-03T10:00:00Z');
      const now = new Date('2026-11-03T10:00:01Z');
      const decision = evaluateCooldown(lastAt, now, REMINDER_COOLDOWN_SECONDS);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.retryAfterSeconds).toBe(REMINDER_COOLDOWN_SECONDS - 1);
      }
    });
  });

  describe('formatRetryAfter', () => {
    it('formats 1s correctly', () => {
      expect(formatRetryAfter(1)).toBe('1 second');
    });

    it('formats 45s correctly', () => {
      expect(formatRetryAfter(45)).toBe('45 seconds');
    });

    it('formats 61s correctly', () => {
      expect(formatRetryAfter(61)).toBe('1 minute 1 second');
    });

    it('formats 3600s correctly', () => {
      expect(formatRetryAfter(3600)).toBe('1 hour');
    });

    it('formats 86399s correctly (23 hours 59 minutes)', () => {
      expect(formatRetryAfter(86399)).toBe('23 hours 59 minutes');
    });

    it('handles plural and singular units properly', () => {
      expect(formatRetryAfter(60)).toBe('1 minute');
      expect(formatRetryAfter(120)).toBe('2 minutes');
      expect(formatRetryAfter(7200)).toBe('2 hours');
      expect(formatRetryAfter(7260)).toBe('2 hours 1 minute');
    });
  });

  describe('evaluateSenderVerification', () => {
    it('allows paid tier even if email is unverified or unknown', () => {
      expect(evaluateSenderVerification({ isPaidTier: true, emailVerified: false })).toEqual({ allowed: true });
      expect(evaluateSenderVerification({ isPaidTier: true, emailVerified: undefined })).toEqual({ allowed: true });
      expect(evaluateSenderVerification({ isPaidTier: true, emailVerified: null })).toEqual({ allowed: true });
    });

    it('allows trial/free tier when emailVerified is literal true', () => {
      expect(evaluateSenderVerification({ isPaidTier: false, emailVerified: true })).toEqual({ allowed: true });
    });

    it('denies trial/free tier when emailVerified is not literal true', () => {
      const expectedDenied = {
        allowed: false,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your e-mail address before sending e-mails to customers. Check your inbox for the verification link.',
      };

      expect(evaluateSenderVerification({ isPaidTier: false, emailVerified: false })).toEqual(expectedDenied);
      expect(evaluateSenderVerification({ isPaidTier: false, emailVerified: undefined })).toEqual(expectedDenied);
      expect(evaluateSenderVerification({ isPaidTier: false, emailVerified: null })).toEqual(expectedDenied);
      expect(evaluateSenderVerification({ isPaidTier: false, emailVerified: 'true' })).toEqual(expectedDenied);
      expect(evaluateSenderVerification({ isPaidTier: false, emailVerified: 1 })).toEqual(expectedDenied);
    });
  });

  describe('sanitizeEmailHeaderText', () => {
    it('strips \\r\\n, tabs, NUL, U+2028 and collapses spaces', () => {
      const raw = 'Acme\r\n\tCorp\u0000\u2028Services   LLC';
      expect(sanitizeEmailHeaderText(raw)).toBe('Acme Corp Services LLC');
    });

    it('neutralizes header injection attempts into a single line', () => {
      const malicious = 'Acme\r\nBcc: x@y.com';
      expect(sanitizeEmailHeaderText(malicious)).toBe('Acme Bcc: x@y.com');
      expect(sanitizeEmailHeaderText(malicious)).not.toContain('\r');
      expect(sanitizeEmailHeaderText(malicious)).not.toContain('\n');
    });

    it('truncates to maxLength', () => {
      const longText = 'A'.repeat(200);
      expect(sanitizeEmailHeaderText(longText, 50)).toBe('A'.repeat(50));
    });
  });

  describe('buildListUnsubscribeHeader', () => {
    it('produces header for a valid address', () => {
      expect(buildListUnsubscribeHeader('billing@example.com')).toEqual({
        'List-Unsubscribe': '<mailto:billing@example.com?subject=Unsubscribe>',
      });
    });

    it('returns empty object for invalid/empty/malformed inputs', () => {
      expect(buildListUnsubscribeHeader(null)).toEqual({});
      expect(buildListUnsubscribeHeader(undefined)).toEqual({});
      expect(buildListUnsubscribeHeader('')).toEqual({});
      expect(buildListUnsubscribeHeader('   ')).toEqual({});
      expect(buildListUnsubscribeHeader('a@b')).toEqual({}); // single label domain
      expect(buildListUnsubscribeHeader('a b@c.com')).toEqual({}); // space
      expect(buildListUnsubscribeHeader('a@b.com,c@d.com')).toEqual({}); // multiple
      expect(buildListUnsubscribeHeader('<x>@y.com')).toEqual({}); // angle bracket
    });
  });

  describe('computeDaysOverdue', () => {
    it('returns 0 when due date is today', () => {
      expect(computeDaysOverdue('2026-11-03', '2026-11-03')).toBe(0);
    });

    it('returns 1 when due date was yesterday', () => {
      expect(computeDaysOverdue('2026-11-02', '2026-11-03')).toBe(1);
    });

    it('returns 30 across month boundaries', () => {
      expect(computeDaysOverdue('2026-10-04', '2026-11-03')).toBe(30);
    });

    it('handles leap-year boundary correctly', () => {
      // 2024 is a leap year (Feb 29 exists)
      expect(computeDaysOverdue('2024-02-28', '2024-03-01')).toBe(2);
    });

    it('returns 0 when due date is in the future', () => {
      expect(computeDaysOverdue('2026-11-04', '2026-11-03')).toBe(0);
      expect(computeDaysOverdue('2027-01-01', '2026-11-03')).toBe(0);
    });

    it('returns 0 on garbage input', () => {
      expect(computeDaysOverdue('invalid', '2026-11-03')).toBe(0);
      expect(computeDaysOverdue('2026-11-03', 'invalid')).toBe(0);
      expect(computeDaysOverdue('', '')).toBe(0);
    });
  });
});
