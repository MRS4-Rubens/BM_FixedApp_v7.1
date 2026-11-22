import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NotFoundView } from '@/components/app/not-found-view';
import {
  DashboardSkeleton,
  DetailPageSkeleton,
  FormPageSkeleton,
  GenericPageSkeleton,
  ListPageSkeleton,
  ReportsSkeleton,
} from '@/components/app/skeletons/page-skeletons';

const REQUIRED_FILES = [
  'components/ui/skeleton.tsx',
  'components/app/skeletons/page-skeletons.tsx',
  'components/app/route-error-view.tsx',
  'components/app/not-found-view.tsx',
  'app/(app)/error.tsx',
  'app/(admin)/error.tsx',
  'app/invite/[token]/error.tsx', // BUG-06
  'app/not-found.tsx',
  'app/(app)/not-found.tsx',
  'app/(app)/loading.tsx',
  'app/(app)/dashboard/loading.tsx',
  'app/(app)/invoices/loading.tsx',
  'app/(app)/invoices/new/loading.tsx',
  'app/(app)/invoices/[id]/loading.tsx',
  'app/(app)/invoices/[id]/credit-note/new/loading.tsx',
  'app/(app)/reports/loading.tsx',
  'app/(app)/customers/loading.tsx',
  'app/(app)/customers/new/loading.tsx',
  'app/(app)/customers/[id]/edit/loading.tsx',
  'app/(app)/products/loading.tsx',
  'app/(app)/products/new/loading.tsx',
  'app/(app)/products/[id]/edit/loading.tsx',
  'app/(app)/dev-boundary-test/page.tsx',
  'app/(app)/dev-boundary-test/boundary-thrower.tsx',
  'app/(app)/dev-boundary-test/skeleton-gallery.tsx',
  'app/(admin)/admin/dev-boundary-test/page.tsx',
] as const;

function readRepoFile(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf8');
}

describe('FE-003: Route-level error, loading, and not-found boundaries', () => {
  it('1. Existence: all required boundary, skeleton, and dev-test files exist', () => {
    for (const file of REQUIRED_FILES) {
      expect(existsSync(join(process.cwd(), file)), `Missing expected file: ${file}`).toBe(true);
    }
  });

  it('2. Directives & Exports: client and server component boundaries follow Next.js contracts', () => {
    const appError = readRepoFile('app/(app)/error.tsx');
    const adminError = readRepoFile('app/(admin)/error.tsx');
    const routeErrorView = readRepoFile('components/app/route-error-view.tsx');
    const thrower = readRepoFile('app/(app)/dev-boundary-test/boundary-thrower.tsx');

    expect(appError.startsWith("'use client'")).toBe(true);
    expect(appError).toContain('export default function');
    expect(adminError.startsWith("'use client'")).toBe(true);
    expect(adminError).toContain('export default function');
    expect(routeErrorView.startsWith("'use client'")).toBe(true);
    expect(thrower.startsWith("'use client'")).toBe(true);

    const serverFiles = [
      'app/not-found.tsx',
      'app/(app)/not-found.tsx',
      'components/app/not-found-view.tsx',
      'components/app/skeletons/page-skeletons.tsx',
      'app/(app)/loading.tsx',
      'app/(app)/dashboard/loading.tsx',
      'app/(app)/invoices/loading.tsx',
      'app/(app)/invoices/new/loading.tsx',
      'app/(app)/invoices/[id]/loading.tsx',
      'app/(app)/invoices/[id]/credit-note/new/loading.tsx',
      'app/(app)/reports/loading.tsx',
      'app/(app)/customers/loading.tsx',
      'app/(app)/customers/new/loading.tsx',
      'app/(app)/customers/[id]/edit/loading.tsx',
      'app/(app)/products/loading.tsx',
      'app/(app)/products/new/loading.tsx',
      'app/(app)/products/[id]/edit/loading.tsx',
    ];

    for (const file of serverFiles) {
      const src = readRepoFile(file);
      expect(src).not.toContain("'use client'");
    }
  });

  it('3. Privacy: error views never render error.message or error.stack and configure Sentry capture', () => {
    const errorFiles = [
      'components/app/route-error-view.tsx',
      'app/(app)/error.tsx',
      'app/(admin)/error.tsx',
      'app/invite/[token]/error.tsx', // BUG-06
    ];

    for (const file of errorFiles) {
      const src = readRepoFile(file);
      expect(src).not.toContain('error.message');
      expect(src).not.toContain('error.stack');
    }

    const routeErrorView = readRepoFile('components/app/route-error-view.tsx');
    expect(routeErrorView).toContain('captureException');
    expect(routeErrorView).toContain('router.refresh()');
    expect(routeErrorView).toContain('reset()');
    expect(routeErrorView).toContain('role="alert"');
  });

  it('4. Purity: loading skeletons have zero backend or server action dependencies', () => {
    const skeletonFiles = [
      'components/app/skeletons/page-skeletons.tsx',
      'app/(app)/loading.tsx',
      'app/(app)/dashboard/loading.tsx',
      'app/(app)/invoices/loading.tsx',
      'app/(app)/invoices/new/loading.tsx',
      'app/(app)/invoices/[id]/loading.tsx',
      'app/(app)/invoices/[id]/credit-note/new/loading.tsx',
      'app/(app)/reports/loading.tsx',
      'app/(app)/customers/loading.tsx',
      'app/(app)/customers/new/loading.tsx',
      'app/(app)/customers/[id]/edit/loading.tsx',
      'app/(app)/products/loading.tsx',
      'app/(app)/products/new/loading.tsx',
      'app/(app)/products/[id]/edit/loading.tsx',
    ];

    const forbiddenImports = ['@/lib/db', '@/lib/actions', '@/lib/auth', 'next/headers', 'server-only'];

    for (const file of skeletonFiles) {
      const src = readRepoFile(file);
      for (const forbidden of forbiddenImports) {
        expect(src).not.toContain(forbidden);
      }
    }
  });

  it('5. Determinism: skeletons contain no dynamic time or random generators', () => {
    const skeletonSrc = readRepoFile('components/app/skeletons/page-skeletons.tsx');
    expect(skeletonSrc).not.toContain('Math.random');
    expect(skeletonSrc).not.toContain('Date.now');
    expect(skeletonSrc).not.toContain('new Date(');
  });

  it('6. Rendering: skeletons render accessible landmarks without images; NotFoundView links to dashboard and home', () => {
    const skeletons = [
      { comp: GenericPageSkeleton, label: 'Loading general' },
      { comp: DashboardSkeleton, label: 'Loading dashboard' },
      { comp: ListPageSkeleton, label: 'Loading invoices' },
      { comp: ReportsSkeleton, label: 'Loading reports' },
      { comp: FormPageSkeleton, label: 'Loading form' },
      { comp: DetailPageSkeleton, label: 'Loading details' },
    ];

    for (const { comp, label } of skeletons) {
      const html = renderToStaticMarkup(createElement(comp, { label }));
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain(label);
      expect(html).toContain('animate-pulse');
      expect(html).toContain(['motion', 'reduce:animate', 'none'].join('-'));
      expect(html).not.toContain('<img');
    }

    const notFoundHtml = renderToStaticMarkup(createElement(NotFoundView));
    expect(notFoundHtml).toContain('href="/dashboard"');
    expect(notFoundHtml).toContain('href="/"');
    expect(notFoundHtml).toContain('404');
    expect(notFoundHtml).not.toContain('<main');
  });

  it('7. Inheritance guard: nested routes under list-loading segments have shape-correct loading overrides', () => {
    const nestedOverrides = [
      'app/(app)/invoices/new',
      'app/(app)/invoices/[id]',
      'app/(app)/invoices/[id]/credit-note/new',
      'app/(app)/customers/new',
      'app/(app)/customers/[id]/edit',
      'app/(app)/products/new',
      'app/(app)/products/[id]/edit',
    ];

    for (const relDir of nestedOverrides) {
      const loadingPath = join(process.cwd(), relDir, 'loading.tsx');
      expect(existsSync(loadingPath), `Missing nested loading override at: ${relDir}/loading.tsx`).toBe(true);
    }

    // Verify all directories in app/(app) that contain a page.tsx under invoices/customers/products have loading.tsx
    function checkDirRecursively(dir: string, parentHasLoading: boolean): void {
      const entries = readdirSync(dir);
      const hasLoading = entries.includes('loading.tsx') || parentHasLoading;
      const hasPage = entries.includes('page.tsx');

      if (hasPage && !entries.includes('loading.tsx') && parentHasLoading) {
        throw new Error(`Directory ${dir} has page.tsx but missing loading.tsx under parent with list loading`);
      }

      for (const entry of entries) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          checkDirRecursively(full, hasLoading);
        }
      }
    }

    // Guard specifically for the segmented entities
    const rootsToGuard = ['app/(app)/invoices', 'app/(app)/customers', 'app/(app)/products'];
    for (const root of rootsToGuard) {
      expect(() => checkDirRecursively(join(process.cwd(), root), false)).not.toThrow();
    }
  });

  it('8. Dev gate: dev-boundary-test pages call notFound() when NODE_ENV is production', () => {
    const appDevPage = readRepoFile('app/(app)/dev-boundary-test/page.tsx');
    const adminDevPage = readRepoFile('app/(admin)/admin/dev-boundary-test/page.tsx');

    expect(appDevPage).toContain("process.env.NODE_ENV === 'production'");
    expect(appDevPage).toContain('notFound()');

    expect(adminDevPage).toContain("process.env.NODE_ENV === 'production'");
    expect(adminDevPage).toContain('notFound()');
  });
});

