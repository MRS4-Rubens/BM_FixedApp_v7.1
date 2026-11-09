import * as Sentry from '@sentry/nextjs';
import { scrubString, scrubValue } from '@/lib/observability/sentry-redaction';
import { currentRequestId } from '@/lib/observability/request-context';

function buildLogLine(
  level: 'error' | 'warn',
  scope: string,
  message: string,
  stack?: string,
  meta?: Record<string, unknown>,
): string {
  const timestamp = new Date().toISOString();
  const requestId = currentRequestId();
  try {
    return JSON.stringify({
      timestamp,
      level,
      scope,
      requestId,
      message: scrubString(message),
      stack: stack ? scrubString(stack) : undefined,
      meta: meta === undefined ? undefined : scrubValue(meta),
    });
  } catch {
    return JSON.stringify({
      timestamp,
      level,
      scope,
      requestId,
      message: '[log serialisation failed]',
    });
  }
}

export function logError(scope: string, error: unknown, meta?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  console.error(buildLogLine('error', scope, message, stack, meta));

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

  const requestId = currentRequestId();
  const tags: Record<string, string> = {
    scope,
    ...(requestId ? { request_id: requestId } : {}),
  };

  if (error instanceof Error) {
    Sentry.captureException(error, {
      tags,
      extra: meta === undefined ? undefined : (scrubValue(meta) as Record<string, unknown>),
    });
  } else {
    Sentry.captureMessage(scrubString(message), {
      level: 'error',
      tags,
      extra: scrubValue({ ...meta, originalError: error }) as Record<string, unknown>,
    });
  }
}

export function logWarn(scope: string, message: string, meta?: Record<string, unknown>): void {
  console.warn(buildLogLine('warn', scope, message, undefined, meta));
  const requestId = currentRequestId();
  Sentry.addBreadcrumb({
    category: 'warning',
    level: 'warning',
    message: `${scope}: ${scrubString(message)}`,
    ...(requestId ? { data: { requestId } } : {}),
  });
}
