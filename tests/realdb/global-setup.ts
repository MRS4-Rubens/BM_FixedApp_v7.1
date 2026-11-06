import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { validateTestDatabaseUrl } from './helpers/url-guard';

export default async function setup(): Promise<void> {
  const url = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL); // throws BEFORE any connection
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
}

