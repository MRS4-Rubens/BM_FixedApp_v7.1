import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { RouteErrorView } from '@/components/app/route-error-view';
import InviteRouteError from '@/app/invite/[token]/error';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('BUG-06: the invite page has a friendly error boundary', () => {
  it('renders the retry view with a home link that suits someone without an account', () => {
    const html = renderToStaticMarkup(<InviteRouteError error={new Error('db cold')} reset={() => undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('href="/"');
    expect(html).toContain('Go to home page');
    expect(html).toContain('Your invitation is still valid');
    expect(html).not.toContain('db cold'); // never the raw error text
    expect(html).not.toContain('saving or finalizing a document');
  });

  it('the app and admin views keep their own links and text', () => {
    const app = renderToStaticMarkup(<RouteErrorView error={new Error('x')} reset={() => undefined} scope="app" />);
    expect(app).toContain('href="/dashboard"');
    expect(app).toContain('saving or finalizing a document');
    const admin = renderToStaticMarkup(<RouteErrorView error={new Error('x')} reset={() => undefined} scope="admin" />);
    expect(admin).toContain('href="/admin"');
  });
});

/**
 * BUG-06: "Save draft" on a NEW invoice navigates to the saved invoice; during that (slow, cold-server) navigation a
 * second click used to create a second draft. The test runner has no DOM, so this guards the hook's source.
 */
describe('BUG-06: one draft save at a time', () => {
  const hook = read('components/app/invoices/invoice-form/use-invoice-submit.ts');
  const start = hook.indexOf('const onSaveDraft = async');
  const onSaveDraft = hook.slice(start, hook.indexOf('const onFinalizeClick', start));

  it('a second call while a save (or its navigation) is running returns immediately', () => {
    expect(onSaveDraft.indexOf('if (savingDraftRef.current) return;')).toBeGreaterThan(-1);
    expect(onSaveDraft.indexOf('savingDraftRef.current = true;')).toBeGreaterThan(
      onSaveDraft.indexOf('if (savingDraftRef.current) return;'),
    );
    // The lock is released on failure, but NOT on success (the page is navigating away); only a safety timer frees it.
    expect(onSaveDraft).toMatch(/finally \{\s*if \(!navigating\) \{\s*savingDraftRef\.current = false;/);
    expect(onSaveDraft).toContain('navigating = true;');
    expect(onSaveDraft).toContain('setTimeout(');
  });

  it('a later save reuses the id of the draft just created, so it updates instead of creating another', () => {
    expect(onSaveDraft).toContain('saveInvoiceDraft({ ...data, id: data.id ?? pendingSavedInvoiceId ?? undefined })');
    expect(onSaveDraft).toContain('setPendingSavedInvoiceId(invoiceId);');
  });

  it('both buttons stay disabled while a draft save runs', () => {
    const card = read('components/app/invoices/invoice-form/totals-summary-card.tsx');
    expect(card.split('disabled={isSubmitting || isFinalizing || isSavingDraft}').length - 1).toBe(2);
    expect(read('components/app/invoices/invoice-form.tsx')).toContain('isSavingDraft={isSavingDraft}');
  });
});
