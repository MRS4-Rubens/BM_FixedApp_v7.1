import { describe, expect, it } from 'vitest';
import { getClientIp, isInternalIp } from '@/lib/rate-limit/upstash';

describe('getClientIp (SEC-005, SEC-01)', () => {
  it('SEC-01: on Render the private load-balancer hop is skipped, so each visitor gets their own bucket', () => {
    // Shape measured on the Render TEST service: the right-most entry is Render's private proxy (10.25.x.x).
    const phone = new Headers({ 'x-forwarded-for': '157.50.10.70, 10.25.107.176' });
    const laptop = new Headers({ 'x-forwarded-for': '49.43.21.31, 10.25.107.176' });
    expect(getClientIp(phone)).toBe('157.50.10.70');
    expect(getClientIp(laptop)).toBe('49.43.21.31');
  });

  it("SEC-01: prefers Cloudflare's cf-connecting-ip (set by the edge, overwrites a visitor's value)", () => {
    const headers = new Headers({
      'cf-connecting-ip': '157.50.10.70',
      'x-forwarded-for': '6.6.6.6, 10.25.107.176',
    });
    expect(getClientIp(headers)).toBe('157.50.10.70');
  });

  it('SEC-01: never trusts x-vercel-forwarded-for or true-client-ip (a visitor can send them on Render)', () => {
    const headers = new Headers({
      'x-vercel-forwarded-for': '1.1.1.1',
      'true-client-ip': '2.2.2.2',
      'x-forwarded-for': '203.0.113.9, 10.25.107.176',
    });
    expect(getClientIp(headers)).toBe('203.0.113.9');
  });

  it('ignores a spoofed left-most x-forwarded-for when a proxy appended the real public address', () => {
    expect(getClientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.0.0.5' }))).toBe('203.0.113.9');
    expect(getClientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('falls back to an internal address only when nothing public is present (local development)', () => {
    expect(getClientIp(new Headers({ 'x-forwarded-for': '127.0.0.1' }))).toBe('127.0.0.1');
    expect(getClientIp(new Headers({ 'x-forwarded-for': '192.168.1.4, 10.0.0.2' }))).toBe('10.0.0.2');
  });

  it('accepts IPv6 addresses (public and from cf-connecting-ip)', () => {
    expect(getClientIp(new Headers({ 'x-forwarded-for': '2409:40f0:4c5:281e::bd, 10.25.107.176' }))).toBe('2409:40f0:4c5:281e::bd');
    expect(getClientIp(new Headers({ 'cf-connecting-ip': '2001:db8::2' }))).toBe('2001:db8::2');
  });

  it('trims whitespace and skips invalid entries (not-an-ip, 999.1.1.1, empty, port included)', () => {
    expect(getClientIp(new Headers({ 'x-forwarded-for': '  198.51.100.5  ,  203.0.113.88  ' }))).toBe('203.0.113.88');
    expect(
      getClientIp(new Headers({ 'x-forwarded-for': 'not-an-ip, 999.1.1.1, , 1.2.3.4:5678, 203.0.113.42, invalid' })),
    ).toBe('203.0.113.42');
    expect(getClientIp(new Headers({ 'cf-connecting-ip': 'garbage', 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('returns unknown when no valid address is present, and never throws', () => {
    expect(getClientIp(new Headers())).toBe('unknown');
    expect(getClientIp(new Headers({ 'x-forwarded-for': 'garbage, 1.2.3.4.5, localhost' }))).toBe('unknown');
    expect(() => getClientIp(new Headers({ 'x-forwarded-for': '' }))).not.toThrow();
    expect(() => getClientIp(new Headers({ 'cf-connecting-ip': '' }))).not.toThrow();
    expect(() => getClientIp(new Headers({ 'x-forwarded-for': ',,,,,' }))).not.toThrow();
  });

  it('classifies internal addresses (private, loopback, link-local, CGNAT, IPv6 ULA/link-local, mapped)', () => {
    for (const ip of ['10.25.107.176', '172.16.0.1', '172.31.255.255', '192.168.0.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isInternalIp(ip), ip).toBe(true);
    }
    for (const ip of ['157.50.10.70', '49.43.21.31', '172.32.0.1', '100.128.0.1', '2409:40f0::1', '::ffff:8.8.8.8']) {
      expect(isInternalIp(ip), ip).toBe(false);
    }
  });

  it('classifies equivalent IPv6 spellings the same way (expanded, upper-case, hex IPv4-mapped)', () => {
    for (const ip of ['0:0:0:0:0:0:0:1', 'FD00:0::1', 'FE80:0:0::1', '::FFFF:10.0.0.1', '::ffff:a19:6bb0', '0:0:0:0:0:ffff:0a00:0001']) {
      expect(isInternalIp(ip), ip).toBe(true);
    }
    for (const ip of ['::ffff:808:808', '2409:40F0:0:0::1']) {
      expect(isInternalIp(ip), ip).toBe(false);
    }
  });
});
