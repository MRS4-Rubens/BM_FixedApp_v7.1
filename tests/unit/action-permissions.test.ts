import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { ACTION_ACCESS, type ActionAccess } from '@/lib/auth/action-permissions';

interface DiscoveredAction {
  readonly filePath: string;
  readonly factory: 'createAuthenticatedAction' | 'createAction';
  readonly scope: string | null;
  readonly hasRolesProperty: boolean;
  readonly rolesText: string | null;
  readonly hasRequirePlatformAdmin: boolean;
  readonly fileContainsEvaluateRoleAccess: boolean;
  readonly fileContainsIsPlatformAdmin: boolean;
}

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === '_shared' || entry === 'node_modules') continue;
      results.push(...collectSourceFiles(fullPath));
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.spec.ts')
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

function parseActionsInFile(filePath: string): DiscoveredAction[] {
  const actions: DiscoveredAction[] = [];
  const fileText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    fileText,
    ts.ScriptTarget.Latest,
    true
  );

  function walk(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      let factory: 'createAuthenticatedAction' | 'createAction' | null = null;
      if (ts.isIdentifier(node.expression)) {
        if (node.expression.text === 'createAuthenticatedAction') {
          factory = 'createAuthenticatedAction';
        } else if (node.expression.text === 'createAction') {
          factory = 'createAction';
        }
      }

      if (factory !== null) {
        let scope: string | null = null;
        if (node.arguments.length >= 3) {
          const arg2 = node.arguments[2];
          if (arg2 && (ts.isStringLiteral(arg2) || ts.isNoSubstitutionTemplateLiteral(arg2))) {
            scope = arg2.text;
          }
        }

        let hasRolesProperty = false;
        let rolesText: string | null = null;
        let hasRequirePlatformAdmin = false;

        if (node.arguments.length >= 4) {
          const arg3 = node.arguments[3];
          if (arg3 && ts.isObjectLiteralExpression(arg3)) {
            for (const prop of arg3.properties) {
              if (ts.isPropertyAssignment(prop)) {
                const propName = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
                  ? prop.name.text
                  : undefined;
                if (propName === 'roles') {
                  hasRolesProperty = true;
                  rolesText = prop.initializer.getText(sourceFile).trim();
                } else if (propName === 'requirePlatformAdmin') {
                  if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) {
                    hasRequirePlatformAdmin = true;
                  }
                }
              }
            }
          }
        }

        actions.push({
          filePath,
          factory,
          scope,
          hasRolesProperty,
          rolesText,
          hasRequirePlatformAdmin,
          fileContainsEvaluateRoleAccess: fileText.includes('evaluateRoleAccess('),
          fileContainsIsPlatformAdmin: fileText.includes('isPlatformAdmin('),
        });
      }
    }

    ts.forEachChild(node, walk);
  }

  walk(sourceFile);
  return actions;
}

describe('Action Permissions AST Drift Guard (lib/auth/action-permissions.ts)', () => {
  const rootDir = process.cwd();
  const searchDirs = [
    join(rootDir, 'lib', 'actions'),
    join(rootDir, 'app'),
  ];
  const allFiles = searchDirs.flatMap((dir) => collectSourceFiles(dir));
  const discoveredActions = allFiles.flatMap((filePath) => parseActionsInFile(filePath));

  it('scans and discovers action definitions in codebase (sanity check: >= 45 call sites)', () => {
    expect(discoveredActions.length).toBeGreaterThanOrEqual(45);
  });

  it('every action call site has a literal scope name and is classified in ACTION_ACCESS', () => {
    for (const action of discoveredActions) {
      expect(
        action.scope,
        `Action in ${action.filePath} must have a literal string 3rd argument (scope name)`
      ).not.toBeNull();

      const scopeName = action.scope;
      if (!scopeName) continue;

      expect(
        scopeName in ACTION_ACCESS,
        `Unclassified action scope "${scopeName}" found in ${action.filePath}. Classify this action in lib/auth/action-permissions.ts.`
      ).toBe(true);
    }
  });

  it('every entry in ACTION_ACCESS matches an actual action call site in the source (no stale entries)', () => {
    const discoveredScopes = new Set(
      discoveredActions
        .map((a) => a.scope)
        .filter((s): s is string => typeof s === 'string')
    );

    for (const scopeName of Object.keys(ACTION_ACCESS)) {
      expect(
        discoveredScopes.has(scopeName),
        `Stale action permission entry "${scopeName}" in lib/auth/action-permissions.ts has no corresponding action call site in source.`
      ).toBe(true);
    }
  });

  it('strictly enforces RBAC conventions for every classified action', () => {
    for (const action of discoveredActions) {
      if (!action.scope) continue;
      const expectedAccess: ActionAccess | undefined =
        ACTION_ACCESS[action.scope as keyof typeof ACTION_ACCESS];

      switch (expectedAccess) {
        case 'owner': {
          expect(
            action.factory,
            `Owner action "${action.scope}" in ${action.filePath} must use createAuthenticatedAction`
          ).toBe('createAuthenticatedAction');
          expect(
            action.hasRolesProperty,
            `Owner action "${action.scope}" in ${action.filePath} must pass "roles: OWNER_ONLY"`
          ).toBe(true);
          expect(
            action.rolesText,
            `Owner action "${action.scope}" in ${action.filePath} must specify roles as exactly OWNER_ONLY`
          ).toBe('OWNER_ONLY');
          break;
        }

        case 'any-member': {
          expect(
            action.factory,
            `Day-to-day action "${action.scope}" in ${action.filePath} must use createAuthenticatedAction`
          ).toBe('createAuthenticatedAction');
          expect(
            action.hasRolesProperty,
            `Day-to-day action "${action.scope}" in ${action.filePath} must not specify roles property`
          ).toBe(false);
          expect(
            action.hasRequirePlatformAdmin,
            `Day-to-day action "${action.scope}" in ${action.filePath} must not specify requirePlatformAdmin`
          ).toBe(false);
          break;
        }

        case 'editor': {
          expect(
            action.factory,
            `Editor action "${action.scope}" in ${action.filePath} must use createAuthenticatedAction`
          ).toBe('createAuthenticatedAction');
          expect(
            action.hasRolesProperty,
            `Editor action "${action.scope}" in ${action.filePath} must pass "roles: EDITOR_ROLES"`
          ).toBe(true);
          expect(
            action.rolesText,
            `Editor action "${action.scope}" in ${action.filePath} must specify roles as exactly EDITOR_ROLES`
          ).toBe('EDITOR_ROLES');
          break;
        }

        case 'signed-in': {
          expect(
            action.factory,
            `Signed-in action "${action.scope}" in ${action.filePath} must use createAuthenticatedAction`
          ).toBe('createAuthenticatedAction');
          expect(
            action.hasRolesProperty,
            `Signed-in action "${action.scope}" in ${action.filePath} must not specify roles property`
          ).toBe(false);
          expect(
            action.hasRequirePlatformAdmin,
            `Signed-in action "${action.scope}" in ${action.filePath} must not specify requirePlatformAdmin`
          ).toBe(false);
          break;
        }

        case 'platform-admin': {
          expect(
            action.factory,
            `Platform admin action "${action.scope}" in ${action.filePath} must use createAuthenticatedAction`
          ).toBe('createAuthenticatedAction');
          expect(
            action.hasRequirePlatformAdmin,
            `Platform admin action "${action.scope}" in ${action.filePath} must specify requirePlatformAdmin: true`
          ).toBe(true);
          break;
        }

        case 'public': {
          expect(
            action.factory,
            `Public action "${action.scope}" in ${action.filePath} must use createAction`
          ).toBe('createAction');
          break;
        }

        case 'owner-or-platform-admin': {
          expect(
            action.hasRolesProperty,
            `Action "${action.scope}" in ${action.filePath} with owner-or-platform-admin access must not use options.roles`
          ).toBe(false);
          expect(
            action.fileContainsEvaluateRoleAccess,
            `Action "${action.scope}" in ${action.filePath} must perform an in-handler evaluateRoleAccess check`
          ).toBe(true);
          expect(
            action.fileContainsIsPlatformAdmin,
            `Action "${action.scope}" in ${action.filePath} must perform an in-handler isPlatformAdmin check`
          ).toBe(true);
          break;
        }

        default: {
          throw new Error(
            `Unhandled ActionAccess type for scope "${action.scope}" in ${action.filePath}`
          );
        }
      }
    }
  });
});

