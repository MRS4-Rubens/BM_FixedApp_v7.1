// tests/unit/sec007-dependency-policy.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateAllowlist } from '../../scripts/ci/audit-gate-core.mjs';

describe('SEC-007: Dependency Security Policies', () => {
  const rootDir = process.cwd();

  it('keeps @neondatabase/auth pinned strictly to 0.4.2-beta in package.json', () => {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.dependencies['@neondatabase/auth']).toBe('0.4.2-beta');
  });

  it('defines patchedDependencies for @neondatabase/auth pointing to existing patch file', () => {
    const workspacePath = path.join(rootDir, 'pnpm-workspace.yaml');
    const workspaceContent = fs.readFileSync(workspacePath, 'utf8');

    expect(workspaceContent).toContain(
      "'@neondatabase/auth': patches/@neondatabase__auth.patch"
    );

    const patchFilePath = path.join(
      rootDir,
      'patches',
      '@neondatabase__auth.patch'
    );
    expect(fs.existsSync(patchFilePath)).toBe(true);
  });

  it('does not contain vulnerable hono 4.12.25 in pnpm-workspace.yaml overrides', () => {
    const workspacePath = path.join(rootDir, 'pnpm-workspace.yaml');
    const workspaceContent = fs.readFileSync(workspacePath, 'utf8');

    expect(workspaceContent).not.toContain('hono: 4.12.25');
    expect(workspaceContent).toMatch(/hono:\s*\^?4\.13\.17/);
  });

  it('ensures shadcn is only in devDependencies and not in dependencies', () => {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    expect(pkg.devDependencies?.shadcn).toBeDefined();
    expect(pkg.dependencies?.shadcn).toBeUndefined();
  });

  it('runs node scripts/ci/audit-gate.mjs in CI and does not contain report-only', () => {
    const ciPath = path.join(rootDir, '.github', 'workflows', 'ci.yml');
    const ciContent = fs.readFileSync(ciPath, 'utf8');

    expect(ciContent).toContain('node scripts/ci/audit-gate.mjs');
    expect(ciContent.toLowerCase()).not.toContain('report-only');
  });

  it('validates security/audit-allowlist.json schema, packages, and expiry dates', () => {
    const allowlistPath = path.join(
      rootDir,
      'security',
      'audit-allowlist.json'
    );
    expect(fs.existsSync(allowlistPath)).toBe(true);

    const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
    expect(validateAllowlist(allowlist)).toBe(true);

    expect(allowlist.entries.length).toBeGreaterThanOrEqual(10);
    for (const entry of allowlist.entries) {
      expect(entry.package).toBe('better-auth');
      expect(entry.expires <= '2027-02-28').toBe(true);
    }
  });

  it('configures .github/dependabot.yml and ignores @neondatabase/auth and better-auth', () => {
    const dependabotPath = path.join(rootDir, '.github', 'dependabot.yml');
    expect(fs.existsSync(dependabotPath)).toBe(true);

    const dependabotContent = fs.readFileSync(dependabotPath, 'utf8');
    expect(dependabotContent).toContain("dependency-name: '@neondatabase/auth'");
    expect(dependabotContent).toContain("dependency-name: 'better-auth'");
  });
});

