import { parseSentryDsn } from '@/config/security-headers.mjs';

export type SentryRuntime = 'client' | 'nodejs' | 'edge';

export interface SentryEnvSource {
  readonly NODE_ENV?: string | undefined;
  readonly SENTRY_DSN?: string | undefined;
  readonly NEXT_PUBLIC_SENTRY_DSN?: string | undefined;
  readonly VERCEL_ENV?: string | undefined;
  readonly NEXT_PUBLIC_VERCEL_ENV?: string | undefined;
  readonly VERCEL_GIT_COMMIT_SHA?: string | undefined;
  readonly NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?: string | undefined;
}

export interface SentryRuntimeConfig {
  readonly enabled: boolean;
  readonly dsn: string | undefined;
  readonly environment: string;
  readonly release: string | undefined;
  readonly tracesSampleRate: number;
}

const ENVIRONMENT_PATTERN = /^[a-z0-9_-]{1,64}$/;
const RELEASE_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;

function firstNonEmpty(...values: ReadonlyArray<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function resolveSentryRuntimeConfig(
  source: SentryEnvSource,
  runtime: SentryRuntime,
): SentryRuntimeConfig {
  // Server runtimes prefer SENTRY_DSN but fall back to the public DSN so existing
  // deployments that only define NEXT_PUBLIC_SENTRY_DSN keep reporting. Browser: public DSN only.
  const rawDsn =
    runtime === 'client'
      ? firstNonEmpty(source.NEXT_PUBLIC_SENTRY_DSN)
      : firstNonEmpty(source.SENTRY_DSN, source.NEXT_PUBLIC_SENTRY_DSN);
  const dsn = rawDsn !== undefined && parseSentryDsn(rawDsn) !== null ? rawDsn : undefined;

  const rawEnvironment = (
    firstNonEmpty(source.VERCEL_ENV, source.NEXT_PUBLIC_VERCEL_ENV, source.NODE_ENV) ?? 'development'
  ).toLowerCase();
  const environment = ENVIRONMENT_PATTERN.test(rawEnvironment) ? rawEnvironment : 'unknown';

  const rawRelease = firstNonEmpty(source.VERCEL_GIT_COMMIT_SHA, source.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA);
  const release = rawRelease !== undefined && RELEASE_PATTERN.test(rawRelease) ? rawRelease : undefined;

  return {
    enabled: dsn !== undefined,
    dsn,
    environment,
    release,
    tracesSampleRate: source.NODE_ENV === 'development' ? 1.0 : 0.1,
  };
}

