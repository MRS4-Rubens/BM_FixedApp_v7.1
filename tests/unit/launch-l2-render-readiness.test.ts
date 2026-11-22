import { beforeEach, describe, expect, it, vi } from 'vitest';

// LAUNCH-L2 (docs/LAUNCH_CHECKLIST.md 2.4, 2.5, 2.10).

const { dbExecute, logWarn, logError } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/lib/db/client', () => ({ db: { execute: dbExecute } }));
vi.mock('@/lib/rate-limit/upstash', () => ({ getRedis: vi.fn() }));
vi.mock('@/lib/actions/_shared/logger', () => ({ logWarn, logError }));

import { checkCoreEnv, isEnvValidationSkipped, type EnvSource } from '@/lib/env';
import { resolveSentryRuntimeConfig } from '@/lib/observability/sentry-config';
import { resetDatabaseHealthCacheForTests } from '@/lib/observability/health';
import { GET as pingGet } from '@/app/ping/route';
import { GET as healthDbGet } from '@/app/health-db/route';
import { DEV_SUPPORT_EMAIL, SUPPORT_EMAIL } from '@/lib/config/contact';

function contactIssues(source: EnvSource) {
  return checkCoreEnv(source).filter((issue) => issue.group === 'contact');
}

describe('LAUNCH-L2 startup safety off Vercel', () => {
  it('SKIP_ENV_VALIDATION works for local/CI builds only', () => {
    expect(isEnvValidationSkipped({ SKIP_ENV_VALIDATION: '1' })).toBe(true);
    expect(isEnvValidationSkipped({ SKIP_ENV_VALIDATION: '0' })).toBe(false);
    expect(isEnvValidationSkipped({})).toBe(false);
  });

  it('is ignored on Vercel production and on every Render service', () => {
    expect(isEnvValidationSkipped({ SKIP_ENV_VALIDATION: '1', VERCEL_ENV: 'production' })).toBe(false);
    expect(isEnvValidationSkipped({ SKIP_ENV_VALIDATION: '1', RENDER: 'true' })).toBe(false);
    expect(isEnvValidationSkipped({ SKIP_ENV_VALIDATION: '1', RENDER: 'true', NODE_ENV: 'production' })).toBe(false);
  });
});

describe('LAUNCH-L2 support e-mail is required in production', () => {
  it('production without NEXT_PUBLIC_SUPPORT_EMAIL refuses to boot', () => {
    expect(contactIssues({ NODE_ENV: 'production' })).toEqual([
      { group: 'contact', name: 'NEXT_PUBLIC_SUPPORT_EMAIL', message: 'is required in production' },
    ]);
  });

  it('production on Render cannot dodge the rule with SKIP_ENV_VALIDATION', () => {
    expect(contactIssues({ NODE_ENV: 'production', RENDER: 'true', SKIP_ENV_VALIDATION: '1' })).toHaveLength(1);
  });

  it('a valid address passes; malformed addresses are rejected in any environment', () => {
    expect(contactIssues({ NODE_ENV: 'production', NEXT_PUBLIC_SUPPORT_EMAIL: 'yourapp@gmail.com' })).toEqual([]);
    expect(contactIssues({ NODE_ENV: 'development', NEXT_PUBLIC_SUPPORT_EMAIL: 'not-an-email' })).toHaveLength(1);
    expect(
      contactIssues({ NODE_ENV: 'production', NEXT_PUBLIC_SUPPORT_EMAIL: 'a@b.co', FEEDBACK_RECIPIENT_EMAIL: 'x, y' }),
    ).toEqual([{ group: 'contact', name: 'FEEDBACK_RECIPIENT_EMAIL', message: 'must be a single e-mail address' }]);
  });

  it('development and CI builds may leave it unset (placeholder, not the old brand domain)', () => {
    expect(contactIssues({ NODE_ENV: 'development' })).toEqual([]);
    expect(contactIssues({ NODE_ENV: 'production', SKIP_ENV_VALIDATION: '1' })).toEqual([]);
    expect(DEV_SUPPORT_EMAIL).toBe('support@example.invalid');
    expect(SUPPORT_EMAIL).not.toContain('billmatrix');
  });
});

describe('LAUNCH-L2 Sentry labels on Render', () => {
  it('uses the explicit environment name first (test / production)', () => {
    const config = resolveSentryRuntimeConfig(
      { NODE_ENV: 'production', NEXT_PUBLIC_SENTRY_ENVIRONMENT: 'test', VERCEL_ENV: 'preview' },
      'nodejs',
    );
    expect(config.environment).toBe('test');
  });

  it('takes the release from RENDER_GIT_COMMIT when no Vercel SHA exists', () => {
    const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    expect(resolveSentryRuntimeConfig({ NODE_ENV: 'production', RENDER_GIT_COMMIT: sha }, 'nodejs').release).toBe(sha);
    expect(resolveSentryRuntimeConfig({ NODE_ENV: 'production', NEXT_PUBLIC_SENTRY_RELEASE: sha }, 'client').release).toBe(sha);
  });

  it('falls back to NODE_ENV when nothing else is set', () => {
    expect(resolveSentryRuntimeConfig({ NODE_ENV: 'production' }, 'nodejs').environment).toBe('production');
  });
});

describe('LAUNCH-L2 uptime routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDatabaseHealthCacheForTests();
  });

  it('/ping answers 200 without touching the database', () => {
    const res = pingGet();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(dbExecute).not.toHaveBeenCalled();
  });

  it('/health-db answers 200 when the database responds', async () => {
    dbExecute.mockResolvedValue([{ '?column?': 1 }]);
    const res = await healthDbGet();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('/health-db answers 503 when the database fails, logs a warning only (no Sentry issue), leaks nothing', async () => {
    dbExecute.mockRejectedValue(new Error('connect ECONNREFUSED ep-secret-host.neon.tech'));
    const res = await healthDbGet();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ status: 'error' });
    expect(JSON.stringify(body)).not.toContain('neon.tech');
    expect(logWarn).toHaveBeenCalledWith('health-db', 'database check failed', { reason: 'Error' });
    expect(logError).not.toHaveBeenCalled();
  });

  it('SVC-05: a healthy answer is reused for 10 minutes, so polling cannot keep Neon awake', async () => {
    vi.useFakeTimers();
    try {
      dbExecute.mockResolvedValue([{ '?column?': 1 }]);
      expect((await healthDbGet()).status).toBe(200);
      await vi.advanceTimersByTimeAsync(9 * 60_000);
      expect((await healthDbGet()).status).toBe(200);
      expect(dbExecute).toHaveBeenCalledTimes(1); // the second answer came from the cache
      await vi.advanceTimersByTimeAsync(61_000);
      await healthDbGet();
      expect(dbExecute).toHaveBeenCalledTimes(2); // after 10 minutes the database is checked again
    } finally {
      vi.useRealTimers();
    }
  });

  it('SVC-05: a failure is re-checked after 1 minute; simultaneous requests share one check', async () => {
    vi.useFakeTimers();
    try {
      dbExecute.mockRejectedValueOnce(new Error('cold')).mockResolvedValue([{ '?column?': 1 }]);
      expect((await healthDbGet()).status).toBe(503);
      expect((await healthDbGet()).status).toBe(503); // cached failure
      await vi.advanceTimersByTimeAsync(61_000);
      const [a, b] = await Promise.all([healthDbGet(), healthDbGet()]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(dbExecute).toHaveBeenCalledTimes(2); // one failed check, then ONE shared check for both requests
    } finally {
      vi.useRealTimers();
    }
  });
});
