import {
  assertBootEnv,
  checkFeatureEnv,
  formatEnvIssues,
  isEnvValidationSkipped,
} from './env';
import { describePayeeProblems, loadPayeeConfig } from './config/payee';

/**
 * Called once from instrumentation.ts (nodejs runtime).
 * - CORE problems throw a single readable EnvConfigError, so a bad deployment fails at boot.
 * - FEATURE problems (storage, pdf, email, rate limit, payee) are logged as errors but do not stop
 *   the server, so unrelated features keep working.
 * Only variable names and reasons are ever logged, never values.
 */
export function runBootEnvCheck(): void {
  if (isEnvValidationSkipped()) {
    console.warn('[env] SKIP_ENV_VALIDATION=1: boot environment validation skipped (local/CI only).');
    return;
  }

  assertBootEnv();

  const featureIssues = checkFeatureEnv();
  if (featureIssues.length > 0) {
    console.error(
      `[env] Feature configuration problems (affected features report errors until fixed):\n${formatEnvIssues(featureIssues)}`,
    );
  }

  const payee = loadPayeeConfig();
  if (payee.status === 'unavailable') {
    console.error(`[env] Payee configuration problems (checkout disabled): ${describePayeeProblems(payee.problems)}`);
  }
}
