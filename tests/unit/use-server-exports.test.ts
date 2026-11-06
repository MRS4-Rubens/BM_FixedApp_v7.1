import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

/**
 * Next.js rule: a 'use server' module may export ONLY async functions (server actions). Anything else
 * (a string constant, a zod schema, a re-export list) crashes the page that loads the module at runtime with
 * "A 'use server' file can only export async functions". Next 16.4 enforces this for re-exports too, which
 * surfaced two latent violations. This AST guard keeps the rule in CI instead of in the browser.
 *
 * Allowed exports: `export async function`, `export const X = createAuthenticatedAction(...)` /
 * `createAction(...)`, `export const X = async (...) => ...`, an alias of one of those declared in the same
 * file, and type-only exports (erased at runtime).
 */

const ROOTS = ['app', 'lib'] as const;
const ACTION_FACTORIES = new Set(['createAuthenticatedAction', 'createAction']);

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      results.push(...collectSourceFiles(fullPath));
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts') && !/\.(test|spec)\.tsx?$/.test(entry)) {
      results.push(fullPath);
    }
  }
  return results;
}

function isUseServerModule(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use server'
  );
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

function isAllowedInitializer(init: ts.Expression | undefined, localAsync: ReadonlySet<string>): boolean {
  if (init === undefined) return false;
  if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
    return ACTION_FACTORIES.has(init.expression.text);
  }
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
    return hasModifier(init, ts.SyntaxKind.AsyncKeyword);
  }
  if (ts.isIdentifier(init)) return localAsync.has(init.text);
  return false;
}

/** Names declared in the file that are safe to export: async functions and action-factory results. */
function collectLocalAsyncNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && hasModifier(statement, ts.SyntaxKind.AsyncKeyword)) {
      names.add(statement.name.text);
    }
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && isAllowedInitializer(decl.initializer, names)) names.add(decl.name.text);
      }
    }
  }
  return names;
}

function findViolations(filePath: string): string[] {
  const text = readFileSync(filePath, 'utf8');
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  if (!isUseServerModule(source)) return [];

  const localAsync = collectLocalAsyncNames(source);
  const rel = relative(process.cwd(), filePath).replace(/\\/g, '/');
  const where = (node: ts.Node): string => `${rel}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const violations: string[] = [];

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.isTypeOnly) violations.push(`${where(statement)} re-export list (export { ... } / export ... from)`);
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      violations.push(`${where(statement)} export default / export =`);
      continue;
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue;
    if (ts.isFunctionDeclaration(statement)) {
      if (!hasModifier(statement, ts.SyntaxKind.AsyncKeyword)) violations.push(`${where(statement)} non-async function`);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!isAllowedInitializer(decl.initializer, localAsync)) {
          violations.push(`${where(decl)} exported value "${decl.name.getText(source)}" is not a server action`);
        }
      }
      continue;
    }
    violations.push(`${where(statement)} exported ${ts.SyntaxKind[statement.kind]}`);
  }
  return violations;
}

describe("'use server' modules export only async functions (Next.js invalid-use-server-value)", () => {
  const files = ROOTS.flatMap((root) => collectSourceFiles(join(process.cwd(), root)));

  it('finds the server-action modules (sanity check)', () => {
    const serverModules = files.filter((f) => /^\s*['"]use server['"]/.test(readFileSync(f, 'utf8')));
    expect(serverModules.length).toBeGreaterThan(30);
  });

  it('has no non-function exports in any use-server module', () => {
    const violations = files.flatMap(findViolations);
    expect(violations).toEqual([]);
  });

  it('detects a violation (self-test of the guard)', () => {
    const probe = ts.createSourceFile(
      'probe.ts',
      "'use server';\nconst A = 'x';\nexport { A };\nexport const B = 'y';\nexport const ok = createAction(s, h, 'p');\n",
      ts.ScriptTarget.Latest,
      true,
    );
    expect(isUseServerModule(probe)).toBe(true);
    const local = collectLocalAsyncNames(probe);
    expect(local.has('ok')).toBe(true);
    expect(local.has('B')).toBe(false);
  });
});
