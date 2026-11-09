import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { getRedis } from '@/lib/rate-limit/upstash';
import { logError } from '@/lib/actions/_shared/logger';

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
