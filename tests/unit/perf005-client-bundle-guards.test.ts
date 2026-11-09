import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { maxBase64Chars } from '@/lib/security/upload-limits';
import { defaultListPeriod } from '@/lib/invoices/list-period';

const PROJECT_ROOT = process.cwd();

function collectSourceFiles(dir: string): string[] {
  const fullDir = path.resolve(PROJECT_ROOT, dir);
  if (!fs.existsSync(fullDir)) return [];
  const results: string[] = [];

  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    const fullPath = path.join(fullDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      results.push(...collectSourceFiles(path.relative(PROJECT_ROOT, fullPath)));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts') &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

function isClientEntry(filePath: string): boolean {
  const content = fs.readFileSync(filePath, 'utf-8');
  // Match 'use client' directive near top of file
  return /^\s*(?:(?:\/\/.*|\/\*[\s\S]*?\*\/)\s*)*['"]use client['"]/m.test(content);
}

function isServerBoundary(filePath: string): boolean {
  const content = fs.readFileSync(filePath, 'utf-8');
  // Match 'use server' directive near top of file (Server Actions RPC stub boundary)
  return /^\s*(?:(?:\/\/.*|\/\*[\s\S]*?\*\/)\s*)*['"]use server['"]/m.test(content);
}

function resolveModulePath(importSpecifier: string, fromFile: string): string | null {
  let targetPath: string;
  if (importSpecifier.startsWith('@/')) {
    targetPath = path.resolve(PROJECT_ROOT, importSpecifier.slice(2));
  } else if (importSpecifier.startsWith('.')) {
    targetPath = path.resolve(path.dirname(fromFile), importSpecifier);
  } else {
    return null; // External package or built-in module
  }

  const extensions = ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
    return path.normalize(targetPath);
  }
  for (const ext of extensions) {
    const candidate = path.normalize(targetPath + ext);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

interface ValueImport {
  specifier: string;
  resolvedPath: string | null;
  fromFile: string;
}

function extractValueImports(filePath: string): ValueImport[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  );

  const valueImports: ValueImport[] = [];

  for (const stmt of sourceFile.statements) {
    // Check static import declarations
    if (ts.isImportDeclaration(stmt)) {
      if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const specifier = stmt.moduleSpecifier.text;

      // Check if it's a type-only import
      if (stmt.importClause) {
        if (stmt.importClause.isTypeOnly) {
          continue; // import type ... -> ignore
        }
        if (
          !stmt.importClause.name &&
          stmt.importClause.namedBindings &&
          ts.isNamedImports(stmt.importClause.namedBindings)
        ) {
          const allType = stmt.importClause.namedBindings.elements.every(
            (el) => el.isTypeOnly,
          );
          if (allType) continue; // import { type X, type Y } -> ignore
        }
      }

      valueImports.push({
        specifier,
        resolvedPath: resolveModulePath(specifier, filePath),
        fromFile: filePath,
      });
    }

    // Check value export declarations with re-exports (export ... from '...')
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) {
      if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      if (stmt.isTypeOnly) continue; // export type ... from '...' -> ignore
      if (
        stmt.exportClause &&
        ts.isNamedExports(stmt.exportClause) &&
        stmt.exportClause.elements.every((el) => el.isTypeOnly)
      ) {
        continue;
      }

      const specifier = stmt.moduleSpecifier.text;
      valueImports.push({
        specifier,
        resolvedPath: resolveModulePath(specifier, filePath),
        fromFile: filePath,
      });
    }
  }

  return valueImports;
}

describe('PERF-005: Client bundle & dead dependency guards', () => {
  it('Test 1 (crawl): client component dependency graph reaches NO database, schema, node or server upload modules', () => {
    const allCandidateFiles = [
      ...collectSourceFiles('app'),
      ...collectSourceFiles('components'),
      ...collectSourceFiles('lib'),
    ];

    const clientEntries = allCandidateFiles.filter(isClientEntry);
    expect(clientEntries.length).toBeGreaterThan(0);

    const visitedFiles = new Set<string>();
    const queue = [...clientEntries];
    // child -> parent, so a violation can be reported with the full chain from its client entry.
    const parentOf = new Map<string, string>();
    const clientEntrySet = new Set(clientEntries);
    const rel = (p: string) => path.relative(PROJECT_ROOT, p).replace(/\\/g, '/');
    const chainTo = (file: string): string => {
      const chain = [rel(file)];
      let cur = file;
      while (parentOf.has(cur) && chain.length < 50) {
        cur = parentOf.get(cur)!;
        chain.unshift(rel(cur));
      }
      return chain.join(' -> ');
    };
    const violations: { file: string; specifier: string; target: string; reason: string }[] = [];

    const isForbiddenTarget = (specifier: string, resolved: string | null) => {
      // 1. drizzle-orm
      if (specifier === 'drizzle-orm' || specifier.startsWith('drizzle-orm/')) {
        return 'drizzle-orm module reached in client bundle';
      }

      // 2. postgres or @neondatabase/serverless
      if (specifier === 'postgres' || specifier === '@neondatabase/serverless' || specifier.startsWith('@neondatabase/serverless/')) {
        return 'server database driver reached in client bundle';
      }

      // 3. node built-ins
      if (specifier.startsWith('node:')) {
        return `node built-in (${specifier}) reached in client bundle`;
      }
      const rawNodeModules = ['crypto', 'fs', 'stream', 'buffer', 'path', 'net', 'os', 'child_process'];
      if (rawNodeModules.includes(specifier)) {
        return `node built-in (${specifier}) reached in client bundle`;
      }

      // 4. lib/security/upload.ts (upload-limits.ts is allowed)
      if (resolved) {
        const norm = path.normalize(resolved).replace(/\\/g, '/');
        if (norm.endsWith('lib/security/upload.ts')) {
          return 'lib/security/upload.ts (contains node:crypto) reached in client bundle';
        }

        // 5. lib/db/schema (tables and barrel)
        // Note: lib/db/schema/_display_prefs.ts is a pure interface/const file with zero dependencies (used for UI display prefs).
        // Any other schema file defines drizzle tables and SQL queries.
        if (
          norm.includes('lib/db/schema') &&
          !norm.endsWith('lib/db/schema/_display_prefs.ts')
        ) {
          return `database schema (${norm}) reached in client bundle`;
        }
      }

      return null;
    };

    while (queue.length > 0) {
      const current = queue.pop()!;
      if (visitedFiles.has(current)) continue;
      visitedFiles.add(current);

      const imports = extractValueImports(current);
      for (const imp of imports) {
        const forbiddenReason = isForbiddenTarget(imp.specifier, imp.resolvedPath);
        if (forbiddenReason) {
          violations.push({
            file: chainTo(current),
            specifier: imp.specifier,
            target: imp.resolvedPath ? path.relative(PROJECT_ROOT, imp.resolvedPath).replace(/\\/g, '/') : imp.specifier,
            reason: forbiddenReason,
          });
        }

        if (imp.resolvedPath && !visitedFiles.has(imp.resolvedPath)) {
          // If the resolved file is a Server Action ('use server'), Next.js replaces it with
          // client RPC dispatcher stubs; its own imports are not pulled into the client bundle.
          if (isServerBoundary(imp.resolvedPath)) {
            continue;
          }

          // Only crawl within our own codebase (app/, components/, lib/)
          const relPath = rel(imp.resolvedPath);
          if (relPath.startsWith('app/') || relPath.startsWith('components/') || relPath.startsWith('lib/')) {
            if (!parentOf.has(imp.resolvedPath) && !clientEntrySet.has(imp.resolvedPath)) {
              parentOf.set(imp.resolvedPath, current);
            }
            queue.push(imp.resolvedPath);
          }
        }
      }
    }

    expect(
      violations,
      `Detected client graph violations:\n${violations.map((v) => `  ${v.file} -> ${v.specifier} (${v.reason})`).join('\n')}`,
    ).toEqual([]);
  }, 30_000);

  it('Test 2: components/app/app-sidebar.tsx does NOT statically import from @/lib/auth/client', () => {
    const sidebarPath = path.resolve(PROJECT_ROOT, 'components/app/app-sidebar.tsx');
    const content = fs.readFileSync(sidebarPath, 'utf-8');

    // Static import matches
    const staticImportRegex = /import\s+[\s\S]*?from\s+['"]@\/lib\/auth\/client['"]/;
    expect(content).not.toMatch(staticImportRegex);

    // Dynamic import must be present in handleSignOut
    expect(content).toContain("import('@/lib/auth/client')");
  });

  it('Test 3: app/(app)/dashboard/page.tsx does NOT directly import @/components/app/dashboard-chart', () => {
    const dashboardPagePath = path.resolve(PROJECT_ROOT, 'app/(app)/dashboard/page.tsx');
    const content = fs.readFileSync(dashboardPagePath, 'utf-8');

    // Should NOT import static dashboard-chart
    const directChartRegex = /from\s+['"]@\/components\/app\/dashboard-chart['"]/;
    expect(content).not.toMatch(directChartRegex);

    // Must import the lazy wrapper
    expect(content).toContain("from '@/components/app/dashboard-chart-lazy'");
  });

  it('Test 3b: the invoice form loads the print-preview modal (all four templates) lazily, only while it is shown', () => {
    const formPath = path.resolve(PROJECT_ROOT, 'components/app/invoices/invoice-form.tsx');
    const content = fs.readFileSync(formPath, 'utf-8');
    expect(content).not.toMatch(/from\s+['"]\.\/invoice-form\/invoice-preview-modal['"]/);
    expect(content).toContain("from './invoice-form/invoice-preview-modal-lazy'");
    expect(content).toContain('(isPreviewOpen || showTemplateUpgradeModal) && (');
  });

  it('Test 4: maxBase64Chars returns exact expected values across boundary inputs', () => {
    // Same formula as before the move: Math.ceil(maxBytes * 1.37) + 256 (0 bytes -> 256, unchanged behaviour)
    expect(maxBase64Chars(0)).toBe(256);

    // 1 byte -> Math.ceil(1 * 1.37) + 256 = 2 + 256 = 258
    const oneByteResult = maxBase64Chars(1);
    expect(oneByteResult).toBe(258);
    expect(oneByteResult).toBeGreaterThan(0);

    // 5 MB = 5 * 1024 * 1024 = 5242880 bytes -> Math.ceil(5242880 * 1.37) + 256 = 7182746 + 256 = 7183002
    const fiveMbResult = maxBase64Chars(5 * 1024 * 1024);
    expect(fiveMbResult).toBe(7183002);
    expect(fiveMbResult).toBeGreaterThan(5 * 1024 * 1024);
  });

  it('Test 5: defaultListPeriod(fixedDate) produces the exact expected { month, year } for a known IST date', () => {
    // Fixed date: 2026-05-15T12:00:00Z -> IST is 2026-05-15 17:30:00
    const fixedDate = new Date('2026-05-15T12:00:00.000Z');
    const result = defaultListPeriod(fixedDate);

    expect(result).toEqual({
      month: 5,
      year: 2026,
    });

    // Also test leap year February in IST: 2028-02-10T10:00:00Z -> 2028-02-10 15:30:00 IST
    const leapDate = new Date('2028-02-10T10:00:00.000Z');
    const leapResult = defaultListPeriod(leapDate);

    expect(leapResult).toEqual({
      month: 2,
      year: 2028,
    });
  });
});
