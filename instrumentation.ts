import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    });

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
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    });
  }
}
