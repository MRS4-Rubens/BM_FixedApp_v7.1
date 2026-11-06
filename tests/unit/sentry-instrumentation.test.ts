import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as Sentry from '@sentry/nextjs';

vi.mock('@sentry/nextjs', () => ({
  init: vi.fn(),
  captureRequestError: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn().mockResolvedValue(true),
  getClient: vi.fn(),
}));

vi.mock('@/lib/env-boot', () => ({
  runBootEnvCheck: vi.fn(),
}));

describe('instrumentation.ts (ARCH-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('exports onRequestError which matches Sentry.captureRequestError', async () => {
    const instrumentation = await import('@/instrumentation');
    expect(instrumentation.onRequestError).toBe(Sentry.captureRequestError);
  });

  it('initializes Sentry for nodejs runtime with environment, release, runtime tag, and beforeSend', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('SENTRY_DSN', 'https://validKey@o0.ingest.sentry.io/9999');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'release-sha-commit-999');

    const { register } = await import('@/instrumentation');
    await register();

    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const initCall = (Sentry.init as unknown as Mock).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(initCall).toBeDefined();
    expect(initCall.dsn).toBe('https://validKey@o0.ingest.sentry.io/9999');
    expect(initCall.environment).toBe('production');
    expect(initCall.release).toBe('release-sha-commit-999');
    expect(initCall.sendDefaultPii).toBe(false);
    expect(initCall.initialScope).toEqual({ tags: { runtime: 'nodejs' } });
    expect(typeof initCall.beforeSend).toBe('function');
    expect(typeof initCall.beforeSendTransaction).toBe('function');

    // Verify beforeSend scrubs sensitive payload
    const beforeSendFn = initCall.beforeSend as (event: Record<string, unknown>) => Record<string, unknown> | null;
    const testEvent = {
      extra: {
        gstin: '27AAAAA0000A1Z5',
        safe: 'kept',
      },
    };
    const scrubbed = beforeSendFn(testEvent);
    expect(scrubbed).not.toBeNull();
    const scrubbedExtra = scrubbed?.extra as Record<string, unknown>;
    expect(scrubbedExtra.gstin).toBe('[redacted]');
    expect(scrubbedExtra.safe).toBe('kept');
  });

  it('does not initialize Sentry when no DSN is provided', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');

    const { register } = await import('@/instrumentation');
    await register();

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('tags runtime: edge when running in edge runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv('SENTRY_DSN', 'https://validKey@o0.ingest.sentry.io/9999');

    const { register } = await import('@/instrumentation');
    await register();

    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const initCall = (Sentry.init as unknown as Mock).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(initCall).toBeDefined();
    expect(initCall.initialScope).toEqual({ tags: { runtime: 'edge' } });
  });
});

