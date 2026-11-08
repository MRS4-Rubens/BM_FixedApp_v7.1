import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildSecurityHeaderRules } from '@/config/security-headers.mjs';

const REPO_ROOT = path.resolve(__dirname, '../..');

describe('ARCH-PDF Architectural Guards', () => {
  it('Guard 1: The 10 obsolete files do not exist on disk', () => {
    const deletedFiles = [
      'app/api/invoices/[id]/archival-render/route.ts',
      'app/api/credit-notes/[id]/archival-render/route.ts',
      'lib/security/archival-token.ts',
      'lib/security/archival-route-guard.ts',
      'lib/security/archival-replay-guard.ts',
      'tests/unit/archival-token.test.ts',
      'tests/unit/archival-token-redaction.test.ts',
      'tests/unit/archival-route-guard.test.ts',
      'tests/unit/archival-replay-guard.test.ts',
      'tests/unit/archival-render-routes.test.ts',
    ];

    for (const relPath of deletedFiles) {
      const fullPath = path.join(REPO_ROOT, relPath);
      expect(fs.existsSync(fullPath), `File should not exist: ${relPath}`).toBe(false);
    }
  });

  it('Guard 2: No file in app/, lib/, components/, tests/ references deleted modules or symbols', () => {
    const forbiddenPatterns = [
      'ARCHIVAL_SIGNING_SECRET',
      'ARCHIVAL_RENDER_PATH_PATTERN',
      'buildArchivalCspPolicy',
      'archival-token',
      'archival-route-guard',
      'archival-replay-guard',
    ];

    const dirsToCheck = ['app', 'lib', 'components', 'tests'];

    function scanDir(dir: string): string[] {
      const results: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...scanDir(full));
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.mjs'))) {
          // Skip this guard file itself
          if (entry.name === 'arch-pdf-guards.test.ts') continue;
          results.push(full);
        }
      }
      return results;
    }

    const files = dirsToCheck.flatMap((d) => scanDir(path.join(REPO_ROOT, d)));
    const violations: { file: string; pattern: string }[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of forbiddenPatterns) {
        if (content.includes(pattern)) {
          violations.push({ file: path.relative(REPO_ROOT, file), pattern });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('Guard 3: buildSecurityHeaderRules returns a 1-element array with source: "/:path*"', () => {
    const rules = buildSecurityHeaderRules({ isProduction: true });
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe('/:path*');
  });

  it('Guard 4: The 5 print components do not contain "use client"', () => {
    const printComponents = [
      'components/app/invoices/templates/template-1.tsx',
      'components/app/invoices/templates/template-2.tsx',
      'components/app/invoices/templates/template-3.tsx',
      'components/app/invoices/templates/template-4.tsx',
      'components/app/credit-notes/credit-note-print-view.tsx',
    ];

    for (const relPath of printComponents) {
      const fullPath = path.join(REPO_ROOT, relPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      expect(content).not.toMatch(/['"]use client['"]/);
    }
  });
});

