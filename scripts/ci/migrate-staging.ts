/**
 * scripts/ci/migrate-staging.ts
 *
 * Runs database migrations against the isolated staging database branch.
 * Enforces strict safety assertions:
 *   - E2E_CONFIRM_STAGING must equal 'yes-this-is-not-production'
 *   - Target database must not be production
 *
 * Executed via:
 *   pnpm e2e:migrate-staging
 */

import { execSync } from 'node:child_process';
import { assertSafeTarget, loadE2eEnv } from '../../e2e/support/env';

function runStagingMigration(): void {
  console.log('[migrate-staging] Loading environment and performing safety checks...');

  const env = loadE2eEnv(process.env);
  assertSafeTarget(env);

  console.log('[migrate-staging] Safety checks passed. Target database is verified as isolated staging.');
  console.log('[migrate-staging] Running drizzle-kit migrate...');

  const migrationEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL_UNPOOLED: env.E2E_STAGING_DATABASE_URL_UNPOOLED,
    DATABASE_URL: env.E2E_STAGING_DATABASE_URL_UNPOOLED,
  };

  try {
    execSync('pnpm drizzle-kit migrate', {
      env: migrationEnv,
      stdio: 'inherit',
    });
    console.log('[migrate-staging] Database migration completed successfully.');
  } catch (error: unknown) {
    console.error('[migrate-staging] ERROR: Migration failed:', error);
    process.exit(1);
  }
}

runStagingMigration();

