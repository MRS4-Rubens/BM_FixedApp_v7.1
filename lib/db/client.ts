import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';
import { getDatabaseEnv } from '@/lib/env';

neonConfig.webSocketConstructor = ws;

function createDb() {
  // POOLED connection string: the running app must use this one, not the unpooled one.
  const pool = new Pool({ connectionString: getDatabaseEnv().DATABASE_URL });
  return drizzle(pool, { schema });
}

type Db = ReturnType<typeof createDb>;

let instance: Db | undefined;

/** Lazily constructed Drizzle client. Throws EnvConfigError if DATABASE_URL is invalid. */
export function getDb(): Db {
  instance ??= createDb();
  return instance;
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
