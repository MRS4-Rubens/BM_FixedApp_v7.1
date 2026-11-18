import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFeatureEnv, type EnvSource } from '@/lib/env';

// E2E local Redis look-alike (CodeRabbit, PR #73): test rate-limit counters must never touch the one real Upstash
// database. A plain http:// Redis address is allowed only for loopback and only when validation is skipped.

const rateLimitIssues = (source: EnvSource) => checkFeatureEnv(source).filter((issue) => issue.group === 'rateLimit');
const base = { UPSTASH_REDIS_REST_TOKEN: 'token' };

describe('Redis address rules (lib/env.ts)', () => {
  it('always accepts an https:// Upstash address', () => {
    expect(rateLimitIssues({ ...base, NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: 'https://x.upstash.io' })).toEqual([]);
  });

  it('accepts http://localhost only on CI/local runs where validation is skipped', () => {
    const local = { ...base, NODE_ENV: 'production', SKIP_ENV_VALIDATION: '1', UPSTASH_REDIS_REST_URL: 'http://localhost:8079' };
    expect(rateLimitIssues(local)).toEqual([]);
    expect(rateLimitIssues({ ...local, UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:8079' })).toEqual([]);
  });

  it('refuses plain http on Render and Vercel production, even with SKIP_ENV_VALIDATION', () => {
    const local = { ...base, NODE_ENV: 'production', SKIP_ENV_VALIDATION: '1', UPSTASH_REDIS_REST_URL: 'http://localhost:8079' };
    expect(rateLimitIssues({ ...local, RENDER: 'true' })).toHaveLength(1);
    expect(rateLimitIssues({ ...local, VERCEL_ENV: 'production' })).toHaveLength(1);
    expect(rateLimitIssues({ ...base, NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: 'http://localhost:8079' })).toHaveLength(1);
  });

  it('refuses plain http to any non-loopback host, even when validation is skipped', () => {
    expect(
      rateLimitIssues({ ...base, SKIP_ENV_VALIDATION: '1', UPSTASH_REDIS_REST_URL: 'http://x.upstash.io' }),
    ).toHaveLength(1);
  });
});

describe('E2E workflow uses the local Redis look-alike', () => {
  const wf = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/e2e.yml'), 'utf8');

  it('runs Redis + serverless-redis-http as service containers and points the app at them', () => {
    expect(wf).toContain('image: redis:7-alpine');
    expect(wf).toContain('image: hiett/serverless-redis-http:0.0.10');
    expect(wf).toContain('UPSTASH_REDIS_REST_URL: http://localhost:8079');
    expect(wf).toContain('-H "Content-Type: application/json" -d \'["PING"]\' http://localhost:8079/');
  });

  it('no longer needs any real Upstash secret, and does not flush', () => {
    expect(wf).not.toContain('secrets.E2E_UPSTASH');
    expect(wf).toContain("E2E_UPSTASH_ALLOW_FLUSH: 'false'");
  });
});
