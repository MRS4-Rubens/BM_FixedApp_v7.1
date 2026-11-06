import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('no unbounded lists guard (PERF-001 static analysis)', () => {
  const root = path.resolve(__dirname, '../..');

  it('verifies all list-{invoices,customers,products,credit-notes,payments}.ts actions contain .limit(', () => {
    const actionsDir = path.join(root, 'lib/actions');
    const targetActionFiles = [
      'list-invoices.ts',
      'list-customers.ts',
      'list-products.ts',
      'list-credit-notes.ts',
      'list-payments.ts',
    ];
    const listFiles: string[] = [];

    function findListFiles(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findListFiles(fullPath);
        } else if (entry.isFile() && targetActionFiles.includes(entry.name)) {
          listFiles.push(fullPath);
        }
      }
    }

    findListFiles(actionsDir);
    expect(listFiles.length).toBe(5);

    for (const filePath of listFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(
        content.includes('.limit('),
        `Expected ${path.relative(root, filePath)} to contain .limit(`,
      ).toBe(true);
    }
  });

  it('verifies app/(app)/invoices/new/page.tsx does not load unbounded customers or products', () => {
    const pagePath = path.join(root, 'app/(app)/invoices/new/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf-8');

    expect(content.includes('from(customers)')).toBe(false);
    expect(content.includes('from(products)')).toBe(false);
  });

  it('verifies app/(app)/credit-notes/page.tsx does not run unbounded from(creditNotes)', () => {
    const pagePath = path.join(root, 'app/(app)/credit-notes/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf-8');

    expect(content.includes('from(creditNotes)')).toBe(false);
  });

  it('verifies components/app/invoices/invoice-form.tsx does not do in-memory customer or product array filtering', () => {
    const formPath = path.join(root, 'components/app/invoices/invoice-form.tsx');
    const content = fs.readFileSync(formPath, 'utf-8');

    expect(content.includes('customers.find')).toBe(false);
    expect(content.includes('products.filter')).toBe(false);
  });

  it('verifies zero occurrences of .offset( in lib/ and app/', () => {
    const targetDirs = [path.join(root, 'lib'), path.join(root, 'app')];
    const offendingFiles: string[] = [];

    function scanForOffset(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanForOffset(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (content.includes('.offset(')) {
            offendingFiles.push(path.relative(root, fullPath));
          }
        }
      }
    }

    for (const d of targetDirs) {
      scanForOffset(d);
    }

    expect(offendingFiles).toEqual([]);
  });
});
