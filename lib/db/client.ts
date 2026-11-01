import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';
import { getDatabaseEnv } from '@/lib/env';
import { logError } from '@/lib/actions/_shared/logger';
import { attachPoolErrorHandler, buildPoolOptions } from './pool-config';

neonConfig.webSocketConstructor = ws;

function createDb() {
  // POOLED connection string: the running app must use this one, not the unpooled one.
  const pool = new Pool(buildPoolOptions(getDatabaseEnv().DATABASE_URL));
  // Attach BEFORE the pool can serve a query: an idle-client 'error' with no listener crashes the process.
  attachPoolErrorHandler(pool, logError);
  return drizzle(pool, { schema });
}

type Db = ReturnType<typeof createDb>;

/**
 * Process-wide singleton anchored on globalThis rather than a module-level variable: Next.js dev HMR
 * re-evaluates this module on every edit, which would otherwise leak a new Pool (and its connections) each time.
 * Behaviour in production is identical to a module singleton.
 */
const globalStore = globalThis as typeof globalThis & { __billMatrixDb?: Db };

/** Lazily constructed Drizzle client. Throws EnvConfigError if DATABASE_URL is invalid. */
export function getDb(): Db {
  globalStore.__billMatrixDb ??= createDb();
  return globalStore.__billMatrixDb;
}

/**
 * Lazy facade so the ~76 existing `import { db }` call sites keep working while no env is read at
 * import time. Every property access resolves the real client on first use. This Proxy is the ONE
 * sanctioned typing boundary in this codebase: `Object.create(null)` is typed `any` by the TS lib,
 * and it is only ever used as an inert Proxy target. Do not copy this pattern elsewhere; new code
 * should call getDb().
 */
export const db: Db = new Proxy<Db>(Object.create(null), {
  get(_target, property) {
    const target = getDb();
    const value: unknown = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
