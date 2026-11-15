import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/auth/client', () => ({
  authClient: {
    signOut: vi.fn(),
  },
}));

vi.mock('@/lib/actions/subscriptions/process-request', () => ({
  processSubscriptionClaim: vi.fn(),
}));

vi.mock('@/lib/actions/subscriptions/update-business-subscription', () => ({
  updateBusinessSubscription: vi.fn(),
}));

vi.mock('@/lib/actions/subscriptions/update-platform-payee', () => ({
  updatePlatformPayeeAction: vi.fn(),
}));

vi.mock('@/lib/actions/subscriptions/get-business-subscriptions', () => ({
  getBusinessSubscriptions: vi.fn(),
}));

vi.mock('@/lib/actions/subscriptions/get-claim-screenshot-url', () => ({
  getClaimScreenshotUrl: vi.fn(),
}));

vi.mock('@/lib/actions/business/admin-update-business-identity', () => ({
  adminUpdateBusinessIdentity: vi.fn(),
}));

import { listComponentSourceFiles, readComponentSources } from '../helpers/component-sources';
import * as AdminConsoleEntry from '@/app/(admin)/admin/admin-console';
import * as BillingTabEntry from '@/components/app/settings/billing-tab';
import * as AppSidebarEntry from '@/components/app/app-sidebar';

function countLines(filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split(/\r?\n/).length;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

describe('debt003b-split-guards', () => {
  const adminConsoleEntry = 'app/(admin)/admin/admin-console.tsx';
  const billingTabEntry = 'components/app/settings/billing-tab.tsx';
  const appSidebarEntry = 'components/app/app-sidebar.tsx';

  it('entry file line counts: admin <= 350, billing <= 300, sidebar <= 300', () => {
    const adminLines = countLines(path.resolve(process.cwd(), adminConsoleEntry));
    const billingLines = countLines(path.resolve(process.cwd(), billingTabEntry));
    const sidebarLines = countLines(path.resolve(process.cwd(), appSidebarEntry));

    expect(adminLines, `${adminConsoleEntry} exceeded 350 lines`).toBeLessThanOrEqual(350);
    expect(billingLines, `${billingTabEntry} exceeded 300 lines`).toBeLessThanOrEqual(300);
    expect(sidebarLines, `${appSidebarEntry} exceeded 300 lines`).toBeLessThanOrEqual(300);
  });

  it('listComponentSourceFiles returns >= 10 files for admin-console, >= 6 for billing-tab, >= 6 for app-sidebar', () => {
    const adminFiles = listComponentSourceFiles(adminConsoleEntry);
    const billingFiles = listComponentSourceFiles(billingTabEntry);
    const sidebarFiles = listComponentSourceFiles(appSidebarEntry);

    expect(adminFiles.length).toBeGreaterThanOrEqual(10);
    expect(billingFiles.length).toBeGreaterThanOrEqual(6);
    expect(sidebarFiles.length).toBeGreaterThanOrEqual(6);
  });

  it('every subfile in all 3 component folders has <= 400 lines', () => {
    const allFiles = [
      ...listComponentSourceFiles(adminConsoleEntry),
      ...listComponentSourceFiles(billingTabEntry),
      ...listComponentSourceFiles(appSidebarEntry),
    ];

    for (const relPath of allFiles) {
      const lines = countLines(path.resolve(process.cwd(), relPath));
      expect(lines, `${relPath} exceeded 400 lines`).toBeLessThanOrEqual(400);
    }
  });

  it('no index.ts in any of the 3 subfolders (no barrel files)', () => {
    const folders = [
      'app/(admin)/admin/admin-console',
      'components/app/settings/billing-tab',
      'components/app/app-sidebar',
    ];

    for (const folder of folders) {
      const indexTs = path.resolve(process.cwd(), folder, 'index.ts');
      const indexTsx = path.resolve(process.cwd(), folder, 'index.tsx');
      expect(fs.existsSync(indexTs), `${indexTs} should not exist`).toBe(false);
      expect(fs.existsSync(indexTsx), `${indexTsx} should not exist`).toBe(false);
    }
  });

  it('pure files have no "use client" and no import from "react"', () => {
    const pureFiles = [
      'app/(admin)/admin/admin-console/types.ts',
      'app/(admin)/admin/admin-console/pagination.ts',
      'app/(admin)/admin/admin-console/chart-data.ts',
      'app/(admin)/admin/admin-console/businesses-csv.ts',
      'components/app/settings/billing-tab/plan-configs.ts',
      'components/app/app-sidebar/nav-items.ts',
    ];

    for (const relPath of pureFiles) {
      const src = fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not contain 'use client'`).not.toContain('use client');
      expect(src, `${relPath} must not import from 'react'`).not.toMatch(/from\s+['"]react['"]/);
      expect(src, `${relPath} must not import from 'react'`).not.toMatch(/import\s+.*['"]react['"]/);
    }
  });

  it('combined admin-console sources contain no alert( or confirm( after stripping comments', () => {
    const combinedAdminSrc = readComponentSources(adminConsoleEntry);
    const stripped = stripComments(combinedAdminSrc);

    expect(stripped).not.toMatch(/\b(?:window\.)?alert\s*\(/);
    expect(stripped).not.toMatch(/\bconfirm\s*\(/);
  });

  it('combined admin-console sources contain role="alert", the 4 original message strings, and useState<AdminTab>("overview")', () => {
    const combinedAdminSrc = readComponentSources(adminConsoleEntry);

    expect(combinedAdminSrc).toContain('role="alert"');
    expect(combinedAdminSrc).toContain('Failed to approve claim.');
    expect(combinedAdminSrc).toContain('Please specify a rejection reason for the client.');
    expect(combinedAdminSrc).toContain('Failed to reject claim.');
    expect(combinedAdminSrc).toContain('Failed to update subscription override.');
    expect(combinedAdminSrc).toContain("useState<AdminTab>('overview')");
  });

  it('entries still export expected symbols', () => {
    expect(AdminConsoleEntry.AdminConsole).toBeDefined();
    expect(typeof AdminConsoleEntry.AdminConsole).toBe('function');

    expect(BillingTabEntry.BillingTab).toBeDefined();
    expect(typeof BillingTabEntry.BillingTab).toBe('function');

    expect(AppSidebarEntry.AppSidebar).toBeDefined();
    expect(typeof AppSidebarEntry.AppSidebar).toBe('function');
  });

  it('sidebar sources still contain "sidebar:collapsed=" and the "DESIGN-SYSTEM-LOCK" comment', () => {
    const combinedSidebarSrc = readComponentSources(appSidebarEntry);

    expect(combinedSidebarSrc).toContain('sidebar:collapsed=');
    expect(combinedSidebarSrc).toContain('DESIGN-SYSTEM-LOCK');
  });
  it('reviewer: the admin console keeps ONE shared transition, so every action button is disabled while any action runs', () => {
    const files = listComponentSourceFiles('app/(admin)/admin/admin-console.tsx');
    const owners = files.filter((f) => /\buseTransition\(/.test(fs.readFileSync(path.resolve(process.cwd(), f), 'utf8')));
    expect(owners).toEqual(['app/(admin)/admin/admin-console/use-claim-actions.ts']);
    const entry = fs.readFileSync(path.resolve(process.cwd(), 'app/(admin)/admin/admin-console.tsx'), 'utf8');
    expect(entry).toContain('useManageSubscription({ startTransition: claims.startTransition })');
    expect(entry).not.toContain('manageSub.isPending');
  });

  it('reviewer: the claims-ledger copy button keeps its original small tick (not the hero card "Copied" label)', () => {
    const ledger = fs.readFileSync(path.resolve(process.cwd(), 'components/app/settings/billing-tab/claims-ledger.tsx'), 'utf8');
    expect(ledger).toMatch(/copiedUtr === sub\.paymentReference \? \(\s*<Check className="size-3\.5 text-emerald-600" \/>/);
  });
});
