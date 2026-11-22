import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

function getAllFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...getAllFiles(fullPath));
      } else if (entry.endsWith('.ts') || entry.endsWith('.mts')) {
        files.push(fullPath);
      }
    }
  } catch {
    // If directory does not exist yet during initial scaffolding
  }
  return files;
}

/**
 * Test modifiers that skip or narrow a run. Matched as a property, not only when a call follows, so chains such as
 * it.skip.each([...]), describe.concurrent.skip(...) or "it.skip (" are caught too (TEST-02).
 */
const SKIP_MODIFIERS: ReadonlyArray<{ readonly pattern: RegExp; readonly name: string }> = [
  { pattern: /\.(?:skip|only|todo)\b/, name: '.skip/.only/.todo' },
  { pattern: /\.(?:skipIf|runIf)\b/, name: '.skipIf/.runIf' },
];

function skipModifiersIn(content: string): string[] {
  return SKIP_MODIFIERS.filter(({ pattern }) => pattern.test(content)).map(({ name }) => name);
}

describe('RealDB Suite Integrity Guard (TEST-002)', () => {
  it('TEST-02: the skip detector catches chained and spaced modifiers and leaves ordinary tests alone', () => {
    for (const code of [
      "it.skip.each([1])('case %i', () => {})",
      "describe.concurrent.skip('x', () => {})",
      "it.skip ('x', () => {})",
      "test.only('x', () => {})",
      "it.todo('x')",
      "describe.skipIf(!url)('x', () => {})",
      "describe.runIf(flag)('x', () => {})",
    ]) {
      expect(skipModifiersIn(code), code).not.toEqual([]);
    }
    for (const code of ["it.each([1])('case %i', () => {})", "describe('x', () => { it('y', () => {}) })", 'const skipped = 0;']) {
      expect(skipModifiersIn(code), code).toEqual([]);
    }
  });

  it('scans all tests/realdb files and ensures no skips, todos, onlys, or retries', () => {
    const realDbDir = join(projectRoot, 'tests', 'realdb');
    const files = getAllFiles(realDbDir);

    const forbiddenPatterns = [...SKIP_MODIFIERS, { pattern: /retry:\s*[1-9]/, name: 'retry > 0' }];

    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const { pattern, name } of forbiddenPatterns) {
        if (pattern.test(content)) {
          violations.push(`${file} contains forbidden pattern "${name}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('TEST-02: tests/integration has no silently skipped suites (real-DB tests belong in tests/realdb)', () => {
    // Opt-in benchmarks that are skipped ON PURPOSE unless explicitly enabled. Never add a real-database test here:
    // it would be skipped in every CI run, as api010/api011/auth004 were until TEST-02.
    const allowedOptIn: Record<string, string> = {
      'perf001-list-performance.test.ts': 'benchmark, runs only with RUN_PERF_TESTS=1',
    };
    const files = getAllFiles(join(projectRoot, 'tests', 'integration'));
    const forbidden = [...SKIP_MODIFIERS.map(({ pattern }) => pattern), /TEST_DATABASE_URL/];

    const violations: string[] = [];
    for (const file of files) {
      const name = file.split(/[\\/]/).pop() ?? file;
      if (name in allowedOptIn) continue;
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        if (pattern.test(content)) violations.push(`${name} contains ${pattern}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('verifies package.json contains test:realdb script', () => {
    const packageJsonPath = join(projectRoot, 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

    expect(packageJson.scripts?.['test:realdb']).toBeDefined();
    expect(packageJson.scripts['test:realdb']).toContain('vitest.realdb.config.mts');
  });

  it('verifies vitest.config.mts excludes tests/realdb/**', () => {
    const vitestConfigPath = join(projectRoot, 'vitest.config.mts');
    const content = readFileSync(vitestConfigPath, 'utf8');

    expect(content).toContain('tests/realdb/**');
  });

  it('verifies .github/workflows/ci.yml contains a job running pnpm test:realdb', () => {
    const ciWorkflowPath = join(projectRoot, '.github', 'workflows', 'ci.yml');
    const content = readFileSync(ciWorkflowPath, 'utf8');

    expect(content).toContain('pnpm test:realdb');
  });
});

