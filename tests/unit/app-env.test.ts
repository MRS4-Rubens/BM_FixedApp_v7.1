import { describe, expect, it } from 'vitest';
import { appEnv, type EnvSource } from '@/lib/env';

/**
 * NEXT_PUBLIC_APP_URL resolution (ARCH-002 fail-closed + Vercel Preview fallback).
 * Preview deployments get a generated address per deployment, so when the variable is unset on a Preview
 * deployment the app uses VERCEL_URL. Production must never fall back.
 */
function parse(source: EnvSource) {
  return appEnv.parse(source);
}

describe('appEnv NEXT_PUBLIC_APP_URL', () => {
  it('uses the explicit value when set, even on a Preview deployment', () => {
    const outcome = parse({
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'bm-fixed-app-v7-1-abc123-team.vercel.app',
      NEXT_PUBLIC_APP_URL: 'https://staging.example.com',
    });
    expect(outcome).toEqual({ ok: true, value: { NEXT_PUBLIC_APP_URL: 'https://staging.example.com' } });
  });

  it('falls back to https://VERCEL_URL on a Preview deployment when unset', () => {
    const outcome = parse({
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'bm-fixed-app-v7-1-abc123-team.vercel.app',
    });
    expect(outcome).toEqual({
      ok: true,
      value: { NEXT_PUBLIC_APP_URL: 'https://bm-fixed-app-v7-1-abc123-team.vercel.app' },
    });
  });

  it('never falls back on a Vercel Production deployment (fail-closed)', () => {
    const outcome = parse({
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
      VERCEL_URL: 'bm-fixed-app-v7-1-abc123-team.vercel.app',
    });
    expect(outcome.ok).toBe(false);
  });

  it('fails in production when unset and not on Vercel', () => {
    expect(parse({ NODE_ENV: 'production' }).ok).toBe(false);
  });

  it('fails on Preview when VERCEL_URL is missing or malformed', () => {
    expect(parse({ NODE_ENV: 'production', VERCEL_ENV: 'preview' }).ok).toBe(false);
    expect(parse({ NODE_ENV: 'production', VERCEL_ENV: 'preview', VERCEL_URL: 'https://x.vercel.app' }).ok).toBe(false);
    expect(parse({ NODE_ENV: 'production', VERCEL_ENV: 'preview', VERCEL_URL: 'x.vercel.app/path' }).ok).toBe(false);
  });

  it('keeps the localhost default in development', () => {
    expect(parse({ NODE_ENV: 'development' })).toEqual({
      ok: true,
      value: { NEXT_PUBLIC_APP_URL: 'http://localhost:3000' },
    });
  });
});
