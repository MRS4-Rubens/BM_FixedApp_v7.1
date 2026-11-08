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
  usePathname: () => '/invoices/new',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/actions/invoices/save-invoice-draft', () => ({
  saveInvoiceDraft: vi.fn(),
}));
vi.mock('@/lib/actions/invoices/finalize-invoice', () => ({
  finalizeInvoice: vi.fn(),
}));
vi.mock('@/lib/actions/invoices/get-next-sequence', () => ({
  getNextSequenceForDate: vi.fn(),
}));
vi.mock('@/lib/actions/customers/search-customer-options', () => ({
  searchCustomerOptions: vi.fn(),
}));
vi.mock('@/lib/actions/products/search-product-options', () => ({
  searchProductOptions: vi.fn(),
}));
vi.mock('@/lib/actions/invoices/delete-invoice-draft', () => ({
  deleteInvoiceDraft: vi.fn(),
}));
vi.mock('@/lib/actions/subscriptions/submit-payment-claim', () => ({
  submitPaymentClaim: vi.fn(),
}));

import { listComponentSourceFiles, readComponentSources } from '../helpers/component-sources';
import * as InvoiceFormEntry from '@/components/app/invoices/invoice-form';
import * as CheckoutFormEntry from '@/app/(app)/checkout/checkout-form';

function countLines(filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split(/\r?\n/).length;
}

function stripComments(src: string): string {
  // Strip block comments and line comments
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

describe('debt003-split-guards', () => {
  const invoiceFormEntry = 'components/app/invoices/invoice-form.tsx';
  const checkoutFormEntry = 'app/(app)/checkout/checkout-form.tsx';

  it('invoice-form.tsx entry file line count <= 450', () => {
    const lines = countLines(path.resolve(process.cwd(), invoiceFormEntry));
    expect(lines).toBeLessThanOrEqual(450);
  });

  it('checkout-form.tsx entry file line count <= 300', () => {
    const lines = countLines(path.resolve(process.cwd(), checkoutFormEntry));
    expect(lines).toBeLessThanOrEqual(300);
  });

  it('listComponentSourceFiles returns >= 6 files for each component', () => {
    const invoiceFiles = listComponentSourceFiles(invoiceFormEntry);
    const checkoutFiles = listComponentSourceFiles(checkoutFormEntry);

    expect(invoiceFiles.length).toBeGreaterThanOrEqual(6);
    expect(checkoutFiles.length).toBeGreaterThanOrEqual(6);
  });

  it('every subfile in both component folders has <= 400 lines', () => {
    const invoiceFiles = listComponentSourceFiles(invoiceFormEntry);
    const checkoutFiles = listComponentSourceFiles(checkoutFormEntry);

    for (const relPath of invoiceFiles) {
      const lines = countLines(path.resolve(process.cwd(), relPath));
      expect(lines, `${relPath} exceeded 400 lines`).toBeLessThanOrEqual(400);
    }

    for (const relPath of checkoutFiles) {
      const lines = countLines(path.resolve(process.cwd(), relPath));
      expect(lines, `${relPath} exceeded 400 lines`).toBeLessThanOrEqual(400);
    }
  });

  it('no index.ts exists in either subfolder (no barrel files)', () => {
    const invoiceIndexTs = path.resolve(process.cwd(), 'components/app/invoices/invoice-form/index.ts');
    const invoiceIndexTsx = path.resolve(process.cwd(), 'components/app/invoices/invoice-form/index.tsx');
    const checkoutIndexTs = path.resolve(process.cwd(), 'app/(app)/checkout/checkout-form/index.ts');
    const checkoutIndexTsx = path.resolve(process.cwd(), 'app/(app)/checkout/checkout-form/index.tsx');

    expect(fs.existsSync(invoiceIndexTs)).toBe(false);
    expect(fs.existsSync(invoiceIndexTsx)).toBe(false);
    expect(fs.existsSync(checkoutIndexTs)).toBe(false);
    expect(fs.existsSync(checkoutIndexTsx)).toBe(false);
  });

  it('form-calculations.ts and plans.ts contain no "use client" and import nothing from "react"', () => {
    const formCalculationsSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'components/app/invoices/invoice-form/form-calculations.ts'),
      'utf-8'
    );
    const plansSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'app/(app)/checkout/checkout-form/plans.ts'),
      'utf-8'
    );

    expect(formCalculationsSrc).not.toContain('use client');
    expect(formCalculationsSrc).not.toMatch(/from\s+['"]react['"]/);
    expect(formCalculationsSrc).not.toMatch(/import\s+.*['"]react['"]/);

    expect(plansSrc).not.toContain('use client');
    expect(plansSrc).not.toMatch(/from\s+['"]react['"]/);
    expect(plansSrc).not.toMatch(/import\s+.*['"]react['"]/);
  });

  it('combined invoice-form sources have no watch( after stripping comments and use useWatch', () => {
    const combinedInvoiceSrc = readComponentSources(invoiceFormEntry);
    const stripped = stripComments(combinedInvoiceSrc);

    expect(stripped).not.toMatch(/\bwatch\s*\(/);
    expect(combinedInvoiceSrc).toContain('useWatch');
  });

  it('exports expected symbols from entry files', () => {
    expect(InvoiceFormEntry.InvoiceForm).toBeDefined();
    expect(typeof InvoiceFormEntry.InvoiceForm).toBe('function');

    expect(CheckoutFormEntry.CheckoutForm).toBeDefined();
    expect(typeof CheckoutFormEntry.CheckoutForm).toBe('function');
  });
  it('reviewer: the product search query is derived from the live form row (like the old watch), never a separate copy', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'components/app/invoices/invoice-form/use-product-suggestions.ts'), 'utf8');
    // A separate useState copy goes stale after selecting a product, reordering or grouping rows.
    expect(src).not.toMatch(/setActiveRowDesc/);
    expect(src).toMatch(/const activeRowDesc = suggestIdx !== null \? \(lineItems\[suggestIdx\]\?\.description \|\| ''\) : ''/);
    const entry = fs.readFileSync(path.resolve(process.cwd(), 'components/app/invoices/invoice-form.tsx'), 'utf8');
    expect(entry).toMatch(/useProductSuggestions\(\{ setValue, lineItems \}\)/);
  });

  it('reviewer: finalize keeps the "save current form data first" rule documented', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'components/app/invoices/invoice-form/use-invoice-submit.ts'), 'utf8');
    expect(src).toContain('Always save the CURRENT form data before finalizing');
    expect(src).toMatch(/id: pendingFinalizeData\.id \?\? pendingSavedInvoiceId \?\? undefined/);
  });
});
