import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function walkDir(dir: string, fileList: string[] = []): string[] {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (
      entry === 'node_modules' ||
      entry === '.next' ||
      entry === '.git' ||
      entry === '.claude' ||
      entry === 'dist' ||
      entry === 'coverage'
    ) {
      continue;
    }
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath, fileList);
    } else if (stat.isFile()) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

const ROOT_DIR = process.cwd();

describe('PERF-004: Architecture and Structural Guards', () => {
  it('1. The text "auth.getSession(" appears ONLY in lib/auth/request-session.ts across app/, lib/, components/', () => {
    const searchDirs = ['app', 'lib', 'components'].map((d) => join(ROOT_DIR, d));
    const allFiles = searchDirs.flatMap((d) => walkDir(d));

    const matches: string[] = [];
    for (const file of allFiles) {
      if (!file.endsWith('.ts') && !file.endsWith('.tsx') && !file.endsWith('.js')) {
        continue;
      }
      const content = readFileSync(file, 'utf8');
      if (content.includes('auth.getSession(')) {
        matches.push(relative(ROOT_DIR, file).replace(/\\/g, '/'));
      }
    }

    expect(matches).toEqual(['lib/auth/request-session.ts']);
  });

  it('2. No file named page.tsx or layout.tsx under app/ contains db.insert, db.update, db.delete or .transaction(', () => {
    const appFiles = walkDir(join(ROOT_DIR, 'app'));
    const pageOrLayoutFiles = appFiles.filter((f) => {
      const base = relative(ROOT_DIR, f).replace(/\\/g, '/');
      return base.endsWith('/page.tsx') || base.endsWith('/layout.tsx');
    });

    const mutatingFiles: string[] = [];
    for (const file of pageOrLayoutFiles) {
      const content = readFileSync(file, 'utf8');
      if (
        content.includes('db.insert(') ||
        content.includes('db.update(') ||
        content.includes('db.delete(') ||
        content.includes('.transaction(')
      ) {
        mutatingFiles.push(relative(ROOT_DIR, file).replace(/\\/g, '/'));
      }
    }

    expect(mutatingFiles).toEqual([]);
  });

  it('3. session.ts, current-business.ts and layout.tsx satisfy caching and query invariants', () => {
    const sessionContent = readFileSync(join(ROOT_DIR, 'lib/auth/session.ts'), 'utf8');
    expect(sessionContent).toContain('cache(');
    expect(sessionContent).toContain('getRequestSession');

    const currentBizContent = readFileSync(join(ROOT_DIR, 'lib/auth/current-business.ts'), 'utf8');
    expect(currentBizContent).toContain('cache(');

    const layoutContent = readFileSync(join(ROOT_DIR, 'app/(app)/layout.tsx'), 'utf8');
    expect(layoutContent).toContain('getCurrentBusiness(');
    expect(layoutContent).not.toContain('.from(businesses)');
  });

  it('4. None of the specified app/(app) pages contain .from(businesses) anymore', () => {
    const targetPages = [
      'app/(app)/checkout/page.tsx',
      'app/(app)/invoices/[id]/page.tsx',
      'app/(app)/invoices/new/page.tsx',
      'app/(app)/reports/page.tsx',
      'app/(app)/settings/page.tsx',
      'app/(app)/customers/[id]/edit/page.tsx',
      'app/(app)/customers/new/page.tsx',
      'app/(app)/invoices/page.tsx',
    ];

    const violations: string[] = [];
    for (const pageRelPath of targetPages) {
      const content = readFileSync(join(ROOT_DIR, pageRelPath), 'utf8');
      if (content.includes('.from(businesses)')) {
        violations.push(pageRelPath);
      }
    }

    expect(violations).toEqual([]);
  });
});

