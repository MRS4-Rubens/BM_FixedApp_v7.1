import { describe, expect, it } from 'vitest';
import {
  AUDIT_EVENTS,
  AuditWriteError,
  assertSafeMetadata,
  sanitizeIp,
  sanitizeUserAgent,
  type AuditMetadata,
} from '@/lib/audit/log';

describe('audit log writer unit tests', () => {
  describe('sanitizeIp', () => {
    it('accepts standard IPv4 addresses', () => {
      expect(sanitizeIp('203.0.113.7')).toBe('203.0.113.7');
      expect(sanitizeIp('127.0.0.1')).toBe('127.0.0.1');
    });

    it('accepts standard IPv6 addresses', () => {
      expect(sanitizeIp('2001:db8::1')).toBe('2001:db8::1');
      expect(sanitizeIp('::ffff:1.2.3.4')).toBe('::ffff:1.2.3.4');
    });

    it('takes the first hop of a forwarded-for comma-separated list', () => {
      expect(sanitizeIp('203.0.113.7, 10.0.0.1, 192.168.1.1')).toBe('203.0.113.7');
      expect(sanitizeIp('  2001:db8::1 , 10.0.0.1')).toBe('2001:db8::1');
    });

    it('rejects invalid or unsafe strings and returns null', () => {
      expect(sanitizeIp('unknown')).toBeNull();
      expect(sanitizeIp('<script>')).toBeNull();
      expect(sanitizeIp('localhost')).toBeNull();
      expect(sanitizeIp('12345'.repeat(10))).toBeNull(); // 50 chars > 45
    });

    it('returns null for empty, null, or undefined values', () => {
      expect(sanitizeIp(null)).toBeNull();
      expect(sanitizeIp(undefined)).toBeNull();
      expect(sanitizeIp('')).toBeNull();
      expect(sanitizeIp('   ')).toBeNull();
    });
  });

  describe('sanitizeUserAgent', () => {
    it('returns clean user agent strings intact', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
      expect(sanitizeUserAgent(ua)).toBe(ua);
    });

    it('strips ASCII control characters', () => {
      const dirty = 'Mozilla/5.0\x00\x08 (Windows\x1b NT 10.0)\x7f';
      const cleaned = sanitizeUserAgent(dirty);
      expect(cleaned).toBe('Mozilla/5.0   (Windows  NT 10.0)');
    });

    it('truncates at 512 characters', () => {
      const longUa = 'A'.repeat(600);
      const sanitized = sanitizeUserAgent(longUa);
      expect(sanitized).toHaveLength(512);
      expect(sanitized).toBe('A'.repeat(512));
    });

    it('returns null for empty, blank, or control-only strings', () => {
      expect(sanitizeUserAgent(null)).toBeNull();
      expect(sanitizeUserAgent(undefined)).toBeNull();
      expect(sanitizeUserAgent('')).toBeNull();
      expect(sanitizeUserAgent('   ')).toBeNull();
      expect(sanitizeUserAgent('\x00\x1f')).toBeNull();
    });
  });

  describe('assertSafeMetadata', () => {
    it('accepts safe scalar metadata and bank_account_last4', () => {
      const metadata: AuditMetadata = {
        invoice_number: 'INV-2026-0001',
        amount_paise: 50000,
        bank_account_last4: '1234',
        nested: {
          flag: true,
          reason: 'Correction',
        },
      };
      expect(() => assertSafeMetadata(metadata)).not.toThrow();
    });

    it('rejects forbidden keys (case-insensitive and variations)', () => {
      const forbiddenSamples: AuditMetadata[] = [
        { password: '123' },
        { user_password: '123' },
        { secret: 'xyz' },
        { client_secret: 'xyz' },
        { token: 'abc' },
        { auth_token: 'abc' },
        { authorization: 'Bearer abc' },
        { cookie: 'session=123' },
        { api_key: 'key-123' },
        { apiKey: 'key-123' },
        { bank_account_number: '1234567890' },
        { account_number: '1234567890' },
        { accountNumber: '1234567890' },
      ];

      for (const sample of forbiddenSamples) {
        expect(() => assertSafeMetadata(sample)).toThrow(AuditWriteError);
      }
    });

    it('rejects nested forbidden keys', () => {
      const nested: AuditMetadata = {
        meta: {
          details: {
            auth_token: 'secret-token',
          },
        },
      };
      expect(() => assertSafeMetadata(nested)).toThrow(AuditWriteError);
    });

    it('rejects non-finite numbers (NaN, Infinity)', () => {
      const nanMeta: AuditMetadata = { value: NaN };
      const infMeta: AuditMetadata = { value: Infinity };
      expect(() => assertSafeMetadata(nanMeta)).toThrow(AuditWriteError);
      expect(() => assertSafeMetadata(infMeta)).toThrow(AuditWriteError);
    });

    it('rejects metadata deeper than 6 levels', () => {
      const deepMeta: AuditMetadata = {
        l1: {
          l2: {
            l3: {
              l4: {
                l5: {
                  l6: {
                    l7: 'too deep',
                  },
                },
              },
            },
          },
        },
      };
      expect(() => assertSafeMetadata(deepMeta)).toThrow(AuditWriteError);
    });

    it('rejects metadata exceeding 16,384 serialized characters', () => {
      const hugeMeta: AuditMetadata = {
        largePayload: 'X'.repeat(16_500),
      };
      expect(() => assertSafeMetadata(hugeMeta)).toThrow(AuditWriteError);
    });
  });

  describe('AUDIT_EVENTS registry', () => {
    it('defines frozen event types and actions', () => {
      expect(AUDIT_EVENTS.invoice).toEqual(['finalize']);
      expect(AUDIT_EVENTS.credit_note).toEqual(['finalize', 'void']);
      expect(AUDIT_EVENTS.payment).toEqual(['record', 'void']);
      expect(AUDIT_EVENTS.business).toContain('subscription_manual_override');
      expect(AUDIT_EVENTS.subscription_request).toEqual(['approve', 'reject']);
    });
  });
});

