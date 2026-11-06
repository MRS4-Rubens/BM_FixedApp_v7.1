// DB-008: financial_years.is_current is deprecated; the current FY is computed dynamically from IST date.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function getSourceFiles(dir: string): string[] {
  const fullDir = resolve(process.cwd(), dir);
  const files: string[] = [];

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
        files.push(fullPath);
      }
    }
  }

  walk(fullDir);
  return files;
}

describe('DB-008: financial_years.is_current deprecation and rollover invariants', () => {
  const rootDirs = ['lib', 'app', 'components'];
  const sourceFiles = rootDirs.flatMap((dir) => getSourceFiles(dir));

  it('ensures no source file references financialYears.is_current', () => {
    const violations: string[] = [];
    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, 'utf8');
      if (content.includes('financialYears.is_current')) {
        violations.push(filePath);
      }
    }
    expect(violations).toEqual([]);
  });

  it('ensures no source file sets or queries is_current as a boolean literal', () => {
    const literalRegex = /\bis_current\s*:\s*(true|false)\b/;
    const violations: string[] = [];
    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, 'utf8');
      if (literalRegex.test(content)) {
        violations.push(filePath);
      }
    }
    expect(violations).toEqual([]);
  });

  it('ensures financial-year-rollover.ts is insert-or-select only and contains no .update() call', () => {
    const rolloverPath = resolve(process.cwd(), 'lib/invoices/financial-year-rollover.ts');
    const content = readFileSync(rolloverPath, 'utf8');
    expect(content).not.toContain('.update(');
  });
});

