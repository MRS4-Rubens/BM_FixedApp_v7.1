import { describe, expect, it } from 'vitest';
import { resolveSentryRuntimeConfig, type SentryEnvSource } from '@/lib/observability/sentry-config';

describe('resolveSentryRuntimeConfig (ARCH-005)', () => {
  const validServerDsn = 'https://serverKey@o0.ingest.sentry.io/12345';
  const validClientDsn = 'https://clientKey@o0.ingest.sentry.io/67890';

  it('server prefers SENTRY_DSN over the public DSN', () => {
    const source: SentryEnvSource = {
      SENTRY_DSN: validServerDsn,
      NEXT_PUBLIC_SENTRY_DSN: validClientDsn,
      NODE_ENV: 'production',
    };

    const nodeConfig = resolveSentryRuntimeConfig(source, 'nodejs');
    expect(nodeConfig.enabled).toBe(true);
    expect(nodeConfig.dsn).toBe(validServerDsn);

    const edgeConfig = resolveSentryRuntimeConfig(source, 'edge');
    expect(edgeConfig.enabled).toBe(true);
    expect(edgeConfig.dsn).toBe(validServerDsn);
  });

  it('server falls back to the public DSN when SENTRY_DSN is absent or empty', () => {
    const source: SentryEnvSource = {
      SENTRY_DSN: '   ',
      NEXT_PUBLIC_SENTRY_DSN: validClientDsn,
      NODE_ENV: 'production',
    };

    const config = resolveSentryRuntimeConfig(source, 'nodejs');
    expect(config.enabled).toBe(true);
    expect(config.dsn).toBe(validClientDsn);
  });

  it('client ignores SENTRY_DSN and uses only NEXT_PUBLIC_SENTRY_DSN', () => {
    const serverOnlySource: SentryEnvSource = {
      SENTRY_DSN: validServerDsn,
      NODE_ENV: 'production',
    };

    const disabledConfig = resolveSentryRuntimeConfig(serverOnlySource, 'client');
    expect(disabledConfig.enabled).toBe(false);
    expect(disabledConfig.dsn).toBeUndefined();

    const bothSource: SentryEnvSource = {
      SENTRY_DSN: validServerDsn,
      NEXT_PUBLIC_SENTRY_DSN: validClientDsn,
      NODE_ENV: 'production',
    };

    const clientConfig = resolveSentryRuntimeConfig(bothSource, 'client');
    expect(clientConfig.enabled).toBe(true);
    expect(clientConfig.dsn).toBe(validClientDsn);
  });

  it('invalid DSN (not-a-url, http://) yields enabled: false with no throw', () => {
    const invalidNotUrl: SentryEnvSource = {
      SENTRY_DSN: 'not-a-url',
      NODE_ENV: 'production',
    };
    expect(() => {
      const config = resolveSentryRuntimeConfig(invalidNotUrl, 'nodejs');
      expect(config.enabled).toBe(false);
      expect(config.dsn).toBeUndefined();
    }).not.toThrow();

    const invalidHttpBare: SentryEnvSource = {
      SENTRY_DSN: 'http://',
      NODE_ENV: 'production',
    };
    expect(() => {
      const config = resolveSentryRuntimeConfig(invalidHttpBare, 'nodejs');
      expect(config.enabled).toBe(false);
      expect(config.dsn).toBeUndefined();
    }).not.toThrow();

    const emptyDsn: SentryEnvSource = {
      SENTRY_DSN: '',
      NODE_ENV: 'production',
    };
    expect(() => {
      const config = resolveSentryRuntimeConfig(emptyDsn, 'nodejs');
      expect(config.enabled).toBe(false);
      expect(config.dsn).toBeUndefined();
    }).not.toThrow();
  });

  it('VERCEL_ENV beats NODE_ENV', () => {
    const source: SentryEnvSource = {
      VERCEL_ENV: 'preview',
      NODE_ENV: 'production',
      NEXT_PUBLIC_VERCEL_ENV: 'development',
    };
    const config = resolveSentryRuntimeConfig(source, 'nodejs');
    expect(config.environment).toBe('preview');

    const publicVercelEnvSource: SentryEnvSource = {
      NEXT_PUBLIC_VERCEL_ENV: 'preview',
      NODE_ENV: 'production',
    };
    const publicConfig = resolveSentryRuntimeConfig(publicVercelEnvSource, 'client');
    expect(publicConfig.environment).toBe('preview');
  });

  it('bad environment string yields unknown', () => {
    const specialChars: SentryEnvSource = {
      VERCEL_ENV: 'staging with spaces!',
    };
    expect(resolveSentryRuntimeConfig(specialChars, 'nodejs').environment).toBe('unknown');

    const tooLong: SentryEnvSource = {
      VERCEL_ENV: 'a'.repeat(65),
    };
    expect(resolveSentryRuntimeConfig(tooLong, 'nodejs').environment).toBe('unknown');
  });

  it('bad release yields undefined and valid release is preserved', () => {
    const validSource: SentryEnvSource = {
      VERCEL_GIT_COMMIT_SHA: 'd3b07384d113edec49eaa6238ad5ff00',
    };
    expect(resolveSentryRuntimeConfig(validSource, 'nodejs').release).toBe(
      'd3b07384d113edec49eaa6238ad5ff00',
    );

    const invalidChars: SentryEnvSource = {
      VERCEL_GIT_COMMIT_SHA: 'sha-with-$bad;chars',
    };
    expect(resolveSentryRuntimeConfig(invalidChars, 'nodejs').release).toBeUndefined();

    const tooLong: SentryEnvSource = {
      VERCEL_GIT_COMMIT_SHA: 'a'.repeat(201),
    };
    expect(resolveSentryRuntimeConfig(tooLong, 'nodejs').release).toBeUndefined();
  });

  it('tracesSampleRate is 1.0 only in development and 0.1 otherwise', () => {
    const devSource: SentryEnvSource = { NODE_ENV: 'development' };
    expect(resolveSentryRuntimeConfig(devSource, 'nodejs').tracesSampleRate).toBe(1.0);

    const prodSource: SentryEnvSource = { NODE_ENV: 'production' };
    expect(resolveSentryRuntimeConfig(prodSource, 'nodejs').tracesSampleRate).toBe(0.1);

    const testSource: SentryEnvSource = { NODE_ENV: 'test' };
    expect(resolveSentryRuntimeConfig(testSource, 'nodejs').tracesSampleRate).toBe(0.1);

    const emptySource: SentryEnvSource = {};
    expect(resolveSentryRuntimeConfig(emptySource, 'nodejs').tracesSampleRate).toBe(0.1);
  });
});

