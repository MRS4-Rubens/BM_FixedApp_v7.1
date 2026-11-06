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

describe('RealDB Suite Integrity Guard (TEST-002)', () => {
  it('scans all tests/realdb files and ensures no skips, todos, onlys, or retries', () => {
    const realDbDir = join(projectRoot, 'tests', 'realdb');
    const files = getAllFiles(realDbDir);

    const forbiddenPatterns = [
      { pattern: /\.skip\(/, name: '.skip(' },
      { pattern: /\.todo\(/, name: '.todo(' },
      { pattern: /\.only\(/, name: '.only(' },
      { pattern: /skipIf\(/, name: 'skipIf(' },
      { pattern: /runIf\(/, name: 'runIf(' },
      { pattern: /retry:\s*[1-9]/, name: 'retry > 0' },
    ];

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

