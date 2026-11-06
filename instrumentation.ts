import * as Sentry from '@sentry/nextjs';
import { resolveSentryRuntimeConfig } from './lib/observability/sentry-config';
import { scrubSentryEvent } from './lib/observability/sentry-redaction';

// ARCH-005: config entry point; allowed to read process.env directly (see ARCHITECTURE.md).
function initSentry(runtime: 'nodejs' | 'edge'): void {
  const config = resolveSentryRuntimeConfig(process.env, runtime);

  if (!config.enabled) {
    if (config.environment === 'production') {
      console.warn(`[sentry] disabled (${runtime}): SENTRY_DSN missing or invalid`);
    }
    return;
  }

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: config.tracesSampleRate,
    sendDefaultPii: false,
    initialScope: { tags: { runtime } },
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
  });
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    initSentry('nodejs');

    try {
      const { runBootEnvCheck } = await import('./lib/env-boot');
      runBootEnvCheck();
    } catch (error: unknown) {
      Sentry.captureException(error);
      await Sentry.flush(2000);
      throw error;
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    initSentry('edge');
  }
}

// Captures errors from RSC rendering, route handlers, and proxy automatically.
export const onRequestError = Sentry.captureRequestError;
