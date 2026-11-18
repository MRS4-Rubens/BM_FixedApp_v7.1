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
