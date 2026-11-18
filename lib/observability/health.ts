import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { getRedis } from '@/lib/rate-limit/upstash';
import { logError, logWarn } from '@/lib/actions/_shared/logger';

// OPT-001: dependency checks behind GET /api/health. Lives outside app/api/health/route.ts because a route file may
// only export HTTP handlers and route config.
const CHECK_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 10_000;

export interface HealthCheckResult {
  readonly status: 'ok' | 'error';
  readonly checks: {
    readonly database: 'ok' | 'error';
    readonly redis: 'ok' | 'error';
  };
  readonly statusCode: 200 | 503;
}

let cachedHealth: { result: HealthCheckResult; expiresAt: number } | null = null;
let inflightCheck: Promise<HealthCheckResult> | null = null;

export function resetHealthCacheForTests(): void {
  cachedHealth = null;
  inflightCheck = null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMsg: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(timeoutMsg));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function checkDatabase(): Promise<'ok' | 'error'> {
  try {
    await withTimeout(
      (async () => {
        await db.execute(sql`select 1`);
      })(),
      CHECK_TIMEOUT_MS,
      'Database health check timed out',
    );
    return 'ok';
  } catch (error) {
    logError('health-check', error, { check: 'database' });
    return 'error';
  }
}

async function checkRedis(): Promise<'ok' | 'error'> {
  try {
    await withTimeout(
      (async () => {
        const redis = getRedis();
        await redis.ping();
      })(),
      CHECK_TIMEOUT_MS,
      'Redis health check timed out',
    );
    return 'ok';
  } catch (error) {
    logError('health-check', error, { check: 'redis' });
    return 'error';
  }
}

async function computeHealth(): Promise<HealthCheckResult> {
  const [database, redis] = await Promise.all([
    checkDatabase(),
    checkRedis(),
  ]);

  const allOk = database === 'ok' && redis === 'ok';
  return {
    status: allOk ? 'ok' : 'error',
    checks: {
      database,
      redis,
    },
    statusCode: allOk ? 200 : 503,
  };
}

export async function getHealthStatus(): Promise<HealthCheckResult> {
  const now = Date.now();
  if (cachedHealth && now < cachedHealth.expiresAt) {
    return cachedHealth.result;
  }

  if (inflightCheck) {
    return inflightCheck;
  }

  inflightCheck = (async () => {
    try {
      const result = await computeHealth();
      cachedHealth = {
        result,
        expiresAt: Date.now() + CACHE_TTL_MS,
      };
      return result;
    } finally {
      inflightCheck = null;
    }
  })();

  return inflightCheck;
}

/* ------------------------------------------------------------------ */
/* LAUNCH-L2: uptime-monitor checks (UptimeRobot)                       */
/* ------------------------------------------------------------------ */

export interface DatabaseHealthResult {
  readonly status: 'ok' | 'error';
  readonly statusCode: 200 | 503;
}

let cachedDatabaseHealth: { result: DatabaseHealthResult; expiresAt: number } | null = null;

export function resetDatabaseHealthCacheForTests(): void {
  cachedDatabaseHealth = null;
}

/**
 * Database-only check behind GET /health-db (polled every 6 h by the uptime monitor, so Neon Free can sleep).
 * Failures go to the server log (logWarn: a breadcrumb, never a Sentry issue): the uptime monitor already alerts on a 503, and a sleeping
 * or restarting database must not create Sentry issues.
 */
export async function getDatabaseHealth(): Promise<DatabaseHealthResult> {
  const now = Date.now();
  if (cachedDatabaseHealth && now < cachedDatabaseHealth.expiresAt) {
    return cachedDatabaseHealth.result;
  }
  let result: DatabaseHealthResult;
  try {
    await withTimeout(
      (async () => {
        await db.execute(sql`select 1`);
      })(),
      CHECK_TIMEOUT_MS,
      'Database health check timed out',
    );
    result = { status: 'ok', statusCode: 200 };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.name : 'UnknownError';
    logWarn('health-db', 'database check failed', { reason }); // breadcrumb only, never a Sentry issue
    result = { status: 'error', statusCode: 503 };
  }
  cachedDatabaseHealth = { result, expiresAt: Date.now() + CACHE_TTL_MS };
  return result;
}
