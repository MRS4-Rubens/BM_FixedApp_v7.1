import { ActionError } from '@/lib/actions/_shared/errors';
import { getPgError } from '@/lib/db/pg-error';
import { toBusyActionError } from '@/lib/db/transaction';

export interface PgConstraintMapping {
  readonly sqlState: string;     // e.g. '23505'
  readonly constraint: string;   // exact constraint / index name
  readonly code: string;         // ActionError code returned to the client
  readonly message: string;      // STATIC, user-safe
  readonly field?: string;       // form field to attach the message to
}

/** Returns a safe ActionError for errors we fully understand; otherwise null. */
export function mapKnownDatabaseError(
  error: unknown,
  mappings: readonly PgConstraintMapping[] = [],
): ActionError | null {
  if (error instanceof ActionError) return error;
  const busy = toBusyActionError(error);
  if (busy !== null) return busy;

  const { code, constraint } = getPgError(error);
  if (code === null || constraint === null) return null;
  const match = mappings.find((m) => m.sqlState === code && m.constraint === constraint);
  if (match === undefined) return null;

  return new ActionError(match.message, {
    code: match.code,
    ...(match.field !== undefined ? { fieldErrors: { [match.field]: [match.message] } } : {}),
  });
}

/**
 * For use as `throw toThrowable(error, mappings)` inside a catch block.
 * Known errors become a safe ActionError; everything else is returned UNCHANGED (same identity when it is
 * already an Error, so Next.js control-flow errors and `unstable_rethrow` keep working) so that the action
 * wrapper logs it once and returns the generic message. Never leaks error text.
 */
export function toThrowable(error: unknown, mappings: readonly PgConstraintMapping[] = []): Error {
  const mapped = mapKnownDatabaseError(error, mappings);
  if (mapped !== null) return mapped;
  return error instanceof Error ? error : new Error('Non-Error value thrown', { cause: error });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Normalises third-party failure payloads (e.g. the mailer's `{name, message}`) into an Error for logError. */
export function toLoggableError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (isRecord(value) && typeof value.message === 'string') {
    const error = new Error(value.message);
    if (typeof value.name === 'string') error.name = value.name;
    return error;
  }
  return new Error('Unknown third-party error', { cause: value });
}

