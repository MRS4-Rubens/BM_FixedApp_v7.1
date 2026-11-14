import type { Pool } from '@neondatabase/serverless';

/**
 * Connection-pool configuration for the Neon serverless driver (DB-006).
 *
 * Pure module: no I/O, no Sentry, no runtime import of the driver, so it is trivially unit-testable.
 * The wiring lives in lib/db/client.ts.
 *
 * The running app uses the POOLED DATABASE_URL. DATABASE_URL_UNPOOLED is for migrations only
 * (drizzle.config.ts / the migrate workflow) and must never be used here.
 */

/** Constructor options of the installed Neon Pool. Derived so it cannot drift from the driver's types. */
export type NeonPoolOptions = NonNullable<ConstructorParameters<typeof Pool>[0]>;

/** Max connections PER server instance. Neon's pooler multiplexes across instances. */
export const DB_POOL_MAX_CONNECTIONS = 5;
/** Idle sockets are closed quickly: serverless instances freeze and idle sockets rot. */
export const DB_POOL_IDLE_TIMEOUT_MS = 10_000;
/**
 * How long a query may wait for a connection: opening one AND queueing behind busy ones. Still fails well before
 * the platform's request timeout instead of hanging.
 * Was 5s; measured 2026-11-14 that was too tight. A new Neon connection took ~2.2s (dev DB in us-east-1 reached from
 * India) and a waking (scale-to-zero) compute adds 1-3s. The dashboard queues ~12 queries on 5 connections, so the
 * last ones waited >5s and failed with "timeout exceeded when trying to connect" (logged as "Failed query").
 */
export const DB_POOL_CONNECTION_TIMEOUT_MS = 15_000;
/** Stable tag for logs and Sentry. */
export const DB_POOL_ERROR_SCOPE = 'db-pool';

export function buildPoolOptions(connectionString: string): NeonPoolOptions {
  return {
    connectionString,
    max: DB_POOL_MAX_CONNECTIONS,
    idleTimeoutMillis: DB_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: DB_POOL_CONNECTION_TIMEOUT_MS,
  };
}

export type PoolErrorReporter = (scope: string, error: unknown, meta?: Record<string, unknown>) => void;

/** The only part of the pool this module needs. */
export interface PoolErrorSource {
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * Pools emit 'error' when an IDLE client's connection dies (compute restart/suspend, network reset, server-side
 * kill). Node's EventEmitter THROWS on an 'error' event with no listener, which crashes the process.
 *
 * The listener:
 *  - takes ONLY the Error. The driver's second argument (the client) holds credentials and is never touched;
 *  - reports a fixed, non-sensitive `meta` (never the connection string);
 *  - never throws: a throwing 'error' listener is itself an uncaught exception.
 */
export function attachPoolErrorHandler(pool: PoolErrorSource, report: PoolErrorReporter): void {
  pool.on('error', (error: Error) => {
    try {
      report(DB_POOL_ERROR_SCOPE, error, { source: 'idle-client' });
    } catch {
      // Intentionally swallowed: reporting must never take the process down.
    }
  });
}

