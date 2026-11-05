import { describe, expect, it } from 'vitest';
import { getClientIp } from '@/lib/rate-limit/upstash';

describe('getClientIp (SEC-005)', () => {
  it('prefers x-vercel-forwarded-for over x-forwarded-for', () => {
    const headers = new Headers({
      'x-vercel-forwarded-for': '203.0.113.195',
      'x-forwarded-for': '198.51.100.4',
    });
    expect(getClientIp(headers)).toBe('203.0.113.195');
  });

  it('picks first valid IP from x-vercel-forwarded-for if comma-separated', () => {
    const headers = new Headers({
      'x-vercel-forwarded-for': '203.0.113.10, 198.51.100.20',
    });
    expect(getClientIp(headers)).toBe('203.0.113.10');
  });

  it('ignores spoofed left-most x-forwarded-for and picks right-most valid IP', () => {
    const headers = new Headers({
      'x-forwarded-for': '6.6.6.6, 203.0.113.9',
    });
    expect(getClientIp(headers)).toBe('203.0.113.9');
  });

  it('accepts IPv6 addresses', () => {
    const headers = new Headers({
      'x-forwarded-for': '2001:db8::1',
    });
    expect(getClientIp(headers)).toBe('2001:db8::1');
  });

  it('accepts IPv6 from x-vercel-forwarded-for', () => {
    const headers = new Headers({
      'x-vercel-forwarded-for': '2001:db8::2',
    });
    expect(getClientIp(headers)).toBe('2001:db8::2');
  });

  it('trims whitespace around IP entries', () => {
    const headers = new Headers({
      'x-forwarded-for': '  198.51.100.5  ,  203.0.113.88  ',
    });
    expect(getClientIp(headers)).toBe('203.0.113.88');
  });

  it('skips invalid entries (not-an-ip, 999.1.1.1, empty, port included 1.2.3.4:5678)', () => {
    const headers = new Headers({
      'x-forwarded-for': 'not-an-ip, 999.1.1.1, , 1.2.3.4:5678, 203.0.113.42, invalid',
    });
    expect(getClientIp(headers)).toBe('203.0.113.42');
  });

  it('returns unknown when no headers are present', () => {
    const headers = new Headers();
    expect(getClientIp(headers)).toBe('unknown');
  });

  it('returns unknown when only invalid headers are present', () => {
    const headers = new Headers({
      'x-forwarded-for': 'garbage, 1.2.3.4.5, localhost',
    });
    expect(getClientIp(headers)).toBe('unknown');
  });

  it('never throws on empty, weird, or malformed inputs', () => {
    expect(() => getClientIp(new Headers({ 'x-forwarded-for': '' }))).not.toThrow();
    expect(() => getClientIp(new Headers({ 'x-vercel-forwarded-for': '' }))).not.toThrow();
    expect(() => getClientIp(new Headers({ 'x-forwarded-for': ',,,,,' }))).not.toThrow();
  });
});

