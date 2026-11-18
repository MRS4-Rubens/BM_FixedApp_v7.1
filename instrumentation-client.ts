import * as Sentry from '@sentry/nextjs';
import { resolveSentryRuntimeConfig } from './lib/observability/sentry-config';
import { scrubSentryEvent } from './lib/observability/sentry-redaction';

const config = resolveSentryRuntimeConfig(
  {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  },
  'client',
);

// Idempotent: this module can be loaded by Next's auto-loader AND by <SentryInit />.
if (config.enabled && Sentry.getClient() === undefined) {
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: config.tracesSampleRate,
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
