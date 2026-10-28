import { sql } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import type { DbTransaction } from '@/lib/db/client';

export const PG_SERIALIZATION_FAILURE = '40001';
export const PG_DEADLOCK_DETECTED = '40P01';
export const PG_LOCK_NOT_AVAILABLE = '55P03';

const DEFAULT_LOCK_TIMEOUT_MS = 8_000;
const MAX_CAUSE_DEPTH = 5;
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

/** Drizzle wraps driver errors (DrizzleQueryError.cause), so walk the cause chain for the SQLSTATE. */
export function getPgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined;
    if ('code' in current && typeof current.code === 'string' && SQLSTATE_PATTERN.test(current.code)) {
      return current.code;
    }
    if (!('cause' in current)) return undefined;
    current = current.cause;
  }
  return undefined;
}

export function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof ActionError) return false;
  const code = getPgErrorCode(error);
  return code === PG_DEADLOCK_DETECTED || code === PG_SERIALIZATION_FAILURE;
}

/** Maps lock timeouts / exhausted deadlock retries to a safe, user-facing ActionError; otherwise null. */
export function toBusyActionError(error: unknown): ActionError | null {
  if (error instanceof ActionError) return null;
  const code = getPgErrorCode(error);
  if (code === PG_LOCK_NOT_AVAILABLE || code === PG_DEADLOCK_DETECTED || code === PG_SERIALIZATION_FAILURE) {
    return new ActionError(
      'The system is busy processing another change to this record. Please wait a moment and try again.',
      { code: 'BUSY' },
    );
  }
  return null;
}

export interface TransactionRetryOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

/**
 * Re-runs a WHOLE transaction when Postgres aborts it with a deadlock or serialization failure.
 * `run` must be side-effect free outside the database (no revalidatePath, no archival, no e-mail).
 * Business errors (ActionError) and every other error are rethrown immediately.
 */
export async function withTransactionRetry<T>(run: () => Promise<T>, options: TransactionRetryOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 3));
  const baseDelayMs = options.baseDelayMs ?? 50;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error: unknown) {
      if (attempt >= maxAttempts || !isRetryableTransactionError(error)) throw error;
      await sleep(baseDelayMs * 2 ** (attempt - 1) * (0.5 + random()));
    }
  }
}

/** Must be the first statement inside a transaction. Waiters fail fast instead of hanging a serverless request. */
export async function setLocalLockTimeout(tx: DbTransaction, timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS): Promise<void> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new RangeError('lock timeout must be an integer between 100 and 60000 ms');
  }
  await tx.execute(sql`select set_config('lock_timeout', ${`${timeoutMs}ms`}, true)`);
}

