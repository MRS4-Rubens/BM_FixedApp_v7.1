import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function getFilesRecursively(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      getFilesRecursively(fullPath, fileList);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('Admin Security Architecture Guards (AUTH-001)', () => {
  const rootDir = process.cwd();
  const scanDirs = ['app', 'lib', 'components'].map((d) => path.join(rootDir, d));
  const allSourceFiles = scanDirs.flatMap((d) => getFilesRecursively(d));

  it('ensures no file except lib/env.ts (and typed consumers lib/auth/admin.ts and submit-payment-claim.ts) contains PLATFORM_ADMIN_EMAILS, and none contain adminEmailAllowlist or process.env.PLATFORM_ADMIN', () => {
    const allowedPlatformAdminEmails = [
      'lib/env.ts',
      'lib/auth/admin.ts',
      'lib/actions/subscriptions/submit-payment-claim.ts',
    ];

    const violations: { file: string; pattern: string }[] = [];

    for (const filePath of allSourceFiles) {
      const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
      const content = fs.readFileSync(filePath, 'utf8');

      if (content.includes('adminEmailAllowlist')) {
        violations.push({ file: relPath, pattern: 'adminEmailAllowlist' });
      }

      if (content.includes('process.env.PLATFORM_ADMIN')) {
        if (relPath !== 'lib/env.ts') {
          violations.push({ file: relPath, pattern: 'process.env.PLATFORM_ADMIN' });
        }
      }

      if (content.includes('PLATFORM_ADMIN_EMAILS')) {
        if (!allowedPlatformAdminEmails.includes(relPath)) {
          violations.push({ file: relPath, pattern: 'PLATFORM_ADMIN_EMAILS' });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('ensures the six admin actions contain requirePlatformAdmin: true and do not import @/lib/auth/server', () => {
    const sixAdminActions = [
      'lib/actions/subscriptions/get-admin-dashboard-stats.ts',
      'lib/actions/subscriptions/get-pending-requests.ts',
      'lib/actions/subscriptions/get-all-users.ts',
      'lib/actions/subscriptions/get-all-businesses.ts',
      'lib/actions/subscriptions/process-request.ts',
      'lib/actions/subscriptions/update-business-subscription.ts',
    ];

    for (const actionFile of sixAdminActions) {
      const filePath = path.join(rootDir, actionFile);
      expect(fs.existsSync(filePath), `Expected file to exist: ${actionFile}`).toBe(true);

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('requirePlatformAdmin: true');
      expect(content).not.toContain('@/lib/auth/server');
    }
  });

  it('ensures get-business-subscriptions.ts contains isPlatformAdmin(', () => {
    const filePath = path.join(
      rootDir,
      'lib/actions/subscriptions/get-business-subscriptions.ts'
    );
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('isPlatformAdmin(');
  });

  it('ensures both layouts import from @/lib/auth/admin', () => {
    const adminLayoutPath = path.join(rootDir, 'app/(admin)/layout.tsx');
    const appLayoutPath = path.join(rootDir, 'app/(app)/layout.tsx');

    const adminLayoutContent = fs.readFileSync(adminLayoutPath, 'utf8');
    const appLayoutContent = fs.readFileSync(appLayoutPath, 'utf8');

    expect(adminLayoutContent).toContain('@/lib/auth/admin');
    expect(appLayoutContent).toContain('@/lib/auth/admin');
  });

  it('ensures create-action.ts contains unstable_rethrow( and its index is lower than the first logError( inside runValidatedHandler', () => {
    const createActionPath = path.join(rootDir, 'lib/actions/_shared/create-action.ts');
    const content = fs.readFileSync(createActionPath, 'utf8');

    const handlerStart = content.indexOf('async function runValidatedHandler');
    expect(handlerStart).toBeGreaterThan(-1);

    const rethrowIndex = content.indexOf('unstable_rethrow(', handlerStart);
    const logErrorIndex = content.indexOf('logError(', handlerStart);

    expect(rethrowIndex).toBeGreaterThan(-1);
    expect(logErrorIndex).toBeGreaterThan(-1);
    expect(rethrowIndex).toBeLessThan(logErrorIndex);
  });
});
