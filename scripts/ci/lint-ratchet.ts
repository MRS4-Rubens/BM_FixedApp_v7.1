/**
 * Lint ratchet (ARCH-003).
 *
 * The codebase still carries lint debt (tracked as DEBT-001), so CI cannot demand zero problems yet.
 * Instead CI enforces a ratchet: the number of ESLint errors/warnings may NEVER increase above the
 * committed baseline in scripts/ci/lint-baseline.json. When debt is paid down, run
 * `pnpm lint:ratchet --update` to lower the baseline. The baseline can only be lowered by this script;
 * raising it requires a deliberate, reviewed edit of the JSON file.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface LintBaseline {
  errors: number;
  warnings: number;
}

interface LintTotals {
  errors: number;
  warnings: number;
  /** One line per problem ("file:line rule message"), printed when the ratchet fails. */
  problems: string[];
}

const BASELINE_PATH = join(process.cwd(), 'scripts', 'ci', 'lint-baseline.json');
const UPDATE_MODE = process.argv.includes('--update');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function readBaseline(): LintBaseline {
  const parsed: unknown = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  if (!isRecord(parsed) || !isNonNegativeInteger(parsed.errors) || !isNonNegativeInteger(parsed.warnings)) {
    throw new Error(`${BASELINE_PATH} must contain non-negative integer "errors" and "warnings".`);
  }
  return { errors: parsed.errors, warnings: parsed.warnings };
}

function runEslint(): LintTotals {
  const result = spawnSync('pnpm', ['exec', 'eslint', '.', '--format', 'json'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  if (result.error) {
    throw result.error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    // ESLint crashed or printed something that is not JSON (e.g. a config error): never treat that as "zero problems".
    throw new Error(`ESLint did not produce valid JSON (exit ${String(result.status)}).\n${result.stderr}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Unexpected ESLint JSON output shape.');
  }
  let errors = 0;
  let warnings = 0;
  const problems: string[] = [];
  for (const file of parsed as unknown[]) {
    if (!isRecord(file) || !isNonNegativeInteger(file.errorCount) || !isNonNegativeInteger(file.warningCount)) {
      throw new Error('Unexpected ESLint result entry shape.');
    }
    errors += file.errorCount;
    warnings += file.warningCount;
    const filePath = typeof file.filePath === 'string' ? file.filePath.replace(process.cwd(), '.') : '?';
    for (const message of Array.isArray(file.messages) ? file.messages : []) {
      if (!isRecord(message)) continue;
      const level = message.severity === 2 ? 'error' : 'warning';
      problems.push(`${filePath}:${String(message.line ?? '?')} ${level} ${String(message.ruleId ?? '(no rule)')} ${String(message.message ?? '')}`);
    }
  }
  return { errors, warnings, problems };
}

function main(): number {
  const baseline = readBaseline();
  const current = runEslint();
  console.log(`ESLint now:      ${current.errors} errors, ${current.warnings} warnings`);
  console.log(`Baseline allows: ${baseline.errors} errors, ${baseline.warnings} warnings`);

  if (current.errors > baseline.errors || current.warnings > baseline.warnings) {
    console.error('\nFAIL: lint problems increased above the baseline. Fix the new problems (do not raise the baseline).');
    console.error(current.problems.slice(0, 50).join('\n'));
    return 1;
  }

  const improved = current.errors < baseline.errors || current.warnings < baseline.warnings;
  if (improved && UPDATE_MODE) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify({ errors: current.errors, warnings: current.warnings }, null, 2)}\n`);
    console.log('\nBaseline lowered. Commit scripts/ci/lint-baseline.json.');
  } else if (improved) {
    console.log('\nPASS (improved). Run `pnpm lint:ratchet --update` and commit the lowered baseline.');
  } else {
    console.log('\nPASS (at baseline).');
  }
  return 0;
}

try {
  process.exit(main());
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
