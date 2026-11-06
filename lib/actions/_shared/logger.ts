import * as Sentry from '@sentry/nextjs';

export function logError(scope: string, error: unknown, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  console.error(JSON.stringify({ timestamp, scope, message, stack, meta }, null, 2));

  // Expected business errors (ActionError) are user-recoverable and must not create Sentry issues.
  if (meta?.expected === true) {
    Sentry.addBreadcrumb({
      category: 'expected-error',
      level: 'info',
      message: scope,
      data: { code: typeof meta.code === 'string' ? meta.code : undefined },
    });
    return;
  }

  if (error instanceof Error) {
    Sentry.captureException(error, {
      tags: { scope },
      extra: meta,
    });
  } else {
    Sentry.captureMessage(message, {
      level: 'error',
      tags: { scope },
      extra: { ...meta, originalError: error },
    });
  }
}
