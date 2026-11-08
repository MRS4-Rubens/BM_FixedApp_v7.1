import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');

function scanDir(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanDir(full));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      results.push(full);
    }
  }
  return results;
}

describe('DEBT-002 Architectural Guards', () => {
  it('1. No .ts/.tsx under app/, components/, lib/ except lib/money.ts contains Math.round(... / 100) * 100', () => {
    const targetDirs = ['app', 'components', 'lib'];
    const files = targetDirs.flatMap((d) => scanDir(path.join(REPO_ROOT, d)));
    const roundRegex = /Math\.round\([^)]*\/\s*100\)\s*\*\s*100/;

    const violations: string[] = [];
    for (const file of files) {
      const relPath = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
      if (relPath === 'lib/money.ts') continue;

      const content = fs.readFileSync(file, 'utf8');
      if (roundRegex.test(content)) {
        violations.push(relPath);
      }
    }

    expect(violations).toEqual([]);
  });

  it('2. Hand-rolled net-bill Math.max patterns are removed from the 5 target files', () => {
    const targetFiles = [
      'components/app/invoices/invoice-detail.tsx',
      'components/app/invoices/payment-section.tsx',
      'components/app/credit-notes/credit-note-detail.tsx',
      'components/app/credit-notes/credit-note-form.tsx',
      'lib/actions/reports/get-itr-data.ts',
    ];

    const grandTotalRegex = /Math\.max\(\s*0\s*,[^)]*grand_total_paise/;
    const originalRegex = /Math\.max\(\s*0\s*,\s*original/;

    const violations: { file: string; pattern: string }[] = [];

    for (const relPath of targetFiles) {
      const fullPath = path.join(REPO_ROOT, relPath);
      const content = fs.readFileSync(fullPath, 'utf8');

      if (grandTotalRegex.test(content)) {
        violations.push({ file: relPath, pattern: 'Math.max(0, ...grand_total_paise)' });
      }
      if (originalRegex.test(content)) {
        violations.push({ file: relPath, pattern: 'Math.max(0, original...)' });
      }
    }

    expect(violations).toEqual([]);
  });

  it('3. The 4 plan-source files import PLAN_SOURCE_COLUMNS and no longer list subscription_plan manually', () => {
    const planSourceFiles = [
      'app/api/reports/export/route.ts',
      'lib/actions/_shared/subscription-guard.ts',
      'lib/actions/business/upload-logo.ts',
      'lib/email/send-guards.ts',
    ];

    for (const relPath of planSourceFiles) {
      const fullPath = path.join(REPO_ROOT, relPath);
      const content = fs.readFileSync(fullPath, 'utf8');

      expect(content).toContain('PLAN_SOURCE_COLUMNS');
      expect(content).not.toContain('subscription_plan: businesses.subscription_plan');
    }
  });
});

