import { Pool } from '@neondatabase/serverless';
import { z } from 'zod';
import { assertSafeTarget, loadE2eEnv, E2eSafetyError, type E2eEnv } from './env';

let poolInstance: Pool | null = null;

function getPool(env: E2eEnv): Pool {
  if (!poolInstance) {
    assertSafeTarget(env);
    poolInstance = new Pool({
      connectionString: env.E2E_DATABASE_URL,
    });
  }
  return poolInstance;
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}

/**
 * Executes a parameterized SQL SELECT query and parses the resulting rows with a Zod schema.
 * Rejects any non-SELECT statement to uphold the read-only invariant.
 */
export async function queryRows<T>(
  sqlText: string,
  params: unknown[],
  schema: z.ZodType<T>,
  env: E2eEnv = loadE2eEnv(),
): Promise<T[]> {
  assertSafeTarget(env);

  const normalized = sqlText.trim().toUpperCase();
  if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
    throw new E2eSafetyError('queryRows may only execute read-only SELECT or WITH statements');
  }

  const pool = getPool(env);
  const client = await pool.connect();
  try {
    const result = await client.query(sqlText, params);
    const parsedRows: T[] = [];
    for (const row of result.rows) {
      const parsed = schema.safeParse(row);
      if (!parsed.success) {
        throw new Error(
          `DB row schema validation failed: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        );
      }
      parsedRows.push(parsed.data);
    }
    return parsedRows;
  } finally {
    client.release();
  }
}

interface UserColumnInfo {
  readonly tableSchema: string;
  readonly tableName: string;
  readonly emailCol: string;
  readonly verifiedCol: string;
}

/**
 * Introspects the database to locate the auth user table and email verification column
 * (supporting neon_auth schema variants or public schema fallback).
 */
async function introspectAuthUserTable(client: {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}): Promise<UserColumnInfo> {
  const query = `
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema IN ('neon_auth', 'public')
      AND (table_name = 'user' OR table_name = 'users')
      AND column_name IN ('email', 'email_verified', 'emailVerified')
    ORDER BY CASE WHEN table_schema = 'neon_auth' THEN 1 ELSE 2 END;
  `;

  const { rows } = await client.query(query);
  const byTable = new Map<string, { schema: string; table: string; cols: Set<string> }>();

  for (const r of rows) {
    const s = String(r.table_schema);
    const t = String(r.table_name);
    const c = String(r.column_name);
    const key = `${s}.${t}`;
    if (!byTable.has(key)) {
      byTable.set(key, { schema: s, table: t, cols: new Set() });
    }
    byTable.get(key)!.cols.add(c);
  }

  for (const item of byTable.values()) {
    if (!item.cols.has('email')) continue;
    const verifiedCol = item.cols.has('email_verified')
      ? 'email_verified'
      : item.cols.has('emailVerified')
        ? 'emailVerified'
        : null;

    if (verifiedCol) {
      return {
        tableSchema: item.schema,
        tableName: item.table,
        emailCol: 'email',
        verifiedCol,
      };
    }
  }

  throw new E2eSafetyError(
    'Unable to discover auth user table with email and email_verified columns in neon_auth or public schemas.',
  );
}

/**
 * The ONE guarded write: marks the run user's email verified in the staging database.
 * Used only when E2E_VERIFY_MODE=db.
 */
export async function markEmailVerified(email: string, env: E2eEnv = loadE2eEnv()): Promise<void> {
  assertSafeTarget(env);

  const pool = getPool(env);
  const client = await pool.connect();
  try {
    const tableInfo = await introspectAuthUserTable(client);

    // Escape identifiers safely
    const targetTable = `"${tableInfo.tableSchema}"."${tableInfo.tableName}"`;
    const targetVerifiedCol = `"${tableInfo.verifiedCol}"`;
    const targetEmailCol = `"${tableInfo.emailCol}"`;

    const updateSql = `
      UPDATE ${targetTable}
      SET ${targetVerifiedCol} = true
      WHERE LOWER(${targetEmailCol}) = LOWER($1);
    `;

    const result = await client.query(updateSql, [email]);
    if (result.rowCount !== 1) {
      throw new Error(
        `markEmailVerified failed: expected exactly 1 row updated for email, but updated ${result.rowCount} rows.`,
      );
    }
  } finally {
    client.release();
  }
}

