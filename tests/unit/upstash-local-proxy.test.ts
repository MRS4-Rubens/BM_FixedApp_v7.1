import { describe, expect, it } from 'vitest';
import { rewriteBody, rewriteCommand, sha1, stripUpstashOnlyFlags } from '../../scripts/ci/upstash-local-proxy-core';

// CI-only proxy: lets @upstash/ratelimit's scripts run on normal Redis by removing the Upstash-only
// `allow-key-locking` shebang flag. The script body must never change.

const BODY = "local key = KEYS[1]\nreturn redis.call('INCR', key)";
const UPSTASH_SCRIPT = `#!lua flags=allow-key-locking\n${BODY}`;

describe('stripUpstashOnlyFlags', () => {
  it('removes the Upstash-only flag and keeps the script body byte-for-byte', () => {
    expect(stripUpstashOnlyFlags(UPSTASH_SCRIPT)).toBe(BODY);
  });

  it('keeps standard Redis flags and drops only allow-key-locking', () => {
    expect(stripUpstashOnlyFlags(`#!lua flags=no-writes,allow-key-locking\n${BODY}`)).toBe(`#!lua flags=no-writes\n${BODY}`);
  });

  it('leaves scripts without the flag (or without a shebang) untouched', () => {
    expect(stripUpstashOnlyFlags(BODY)).toBe(BODY);
    expect(stripUpstashOnlyFlags(`#!lua flags=no-writes\n${BODY}`)).toBe(`#!lua flags=no-writes\n${BODY}`);
    expect(stripUpstashOnlyFlags(`#!lua\n${BODY}`)).toBe(`#!lua\n${BODY}`);
  });
});

describe('rewriteCommand / rewriteBody', () => {
  it('cleans EVAL scripts and maps the original hash, so later EVALSHA calls hit the cleaned script', () => {
    const map = new Map<string, string>();
    expect(rewriteCommand(['EVAL', UPSTASH_SCRIPT, 1, 'k', 5], map)).toEqual(['EVAL', BODY, 1, 'k', 5]);
    expect(map.get(sha1(UPSTASH_SCRIPT))).toBe(sha1(BODY));
    expect(rewriteCommand(['evalsha', sha1(UPSTASH_SCRIPT), 1, 'k'], map)).toEqual(['evalsha', sha1(BODY), 1, 'k']);
  });

  it('an unknown EVALSHA hash passes through, so the library gets NOSCRIPT and falls back to EVAL', () => {
    const map = new Map<string, string>();
    expect(rewriteCommand(['EVALSHA', 'deadbeef', 0], map)).toEqual(['EVALSHA', 'deadbeef', 0]);
  });

  it('cleans SCRIPT LOAD and every command of a pipeline; other commands are untouched', () => {
    const map = new Map<string, string>();
    expect(rewriteCommand(['SCRIPT', 'LOAD', UPSTASH_SCRIPT], map)).toEqual(['SCRIPT', 'LOAD', BODY]);
    expect(
      rewriteBody('/pipeline', [['GET', 'a'], ['EVAL', UPSTASH_SCRIPT, 0], ['SET', 'b', '1']], map),
    ).toEqual([['GET', 'a'], ['EVAL', BODY, 0], ['SET', 'b', '1']]);
    expect(rewriteBody('/', ['PING'], map)).toEqual(['PING']);
    expect(rewriteBody('/', { not: 'a command' }, map)).toEqual({ not: 'a command' });
  });
});

describe('E2E auth counter reset talks the body-command format (works on Upstash and the CI look-alike)', () => {
  it('sends SCAN as a POST body command, then deletes only auth rate-limit keys', async () => {
    const { resetAuthRateLimits } = await import('@/e2e/support/rate-limits');
    const calls: Array<{ url: string; body: unknown }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: String(url), body });
      if (Array.isArray(body) && body[0] === 'SCAN') {
        return new Response(JSON.stringify({ result: ['0', ['@upstash/ratelimit:auth-signup-ip:1.2.3.4', 'other:key']] }));
      }
      return new Response(JSON.stringify([{ result: 1 }]));
    }) as typeof fetch;
    try {
      const deleted = await resetAuthRateLimits({
        E2E_BASE_URL: 'http://localhost:3000',
        E2E_CONFIRM_STAGING: 'yes-this-is-not-production',
        E2E_FORBIDDEN_HOSTS: 'prod.example.com',
        E2E_DATABASE_URL: 'postgresql://u:p@ep-test.neon.tech/neondb',
        E2E_DB_HOST_ALLOWLIST: 'ep-test.neon.tech',
        E2E_FORBIDDEN_DB_HOSTS: 'ep-prod.neon.tech',
        E2E_VERIFY_MODE: 'db',
        E2E_EXPECT_VERIFICATION_REQUIRED: true,
        E2E_ADMIN_EMAIL: 'admin@test.example',
        E2E_ADMIN_PASSWORD: 'Password12345!',
        E2E_UPSTASH_REST_URL: 'http://localhost:8080',
        E2E_UPSTASH_REST_TOKEN: 'e2e-local-srh-token',
        E2E_UPSTASH_HOST_ALLOWLIST: 'localhost',
        E2E_UPSTASH_ALLOW_FLUSH: true,
        E2E_UPDATE_A11Y_BASELINE: false,
        E2E_EXPECT_ARCHIVAL: false,
      });
      const scan = calls.find((c) => Array.isArray(c.body) && (c.body as unknown[])[0] === 'SCAN');
      expect(scan?.url).toBe('http://localhost:8080');
      expect(scan?.body).toEqual(['SCAN', '0', 'MATCH', '@upstash/ratelimit:auth-signup-ip*', 'COUNT', '100']);
      const del = calls.find((c) => c.url.endsWith('/pipeline'));
      expect(del?.body).toEqual([['DEL', '@upstash/ratelimit:auth-signup-ip:1.2.3.4']]);
      expect(deleted).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
