import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readComponentSources } from '../helpers/component-sources';

const ROOT_DIR = process.cwd();

function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function walkFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    if (
      entry === 'node_modules' ||
      entry === '.next' ||
      entry === '.git' ||
      entry === 'dist' ||
      entry === 'coverage'
    ) {
      continue;
    }
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkFiles(fullPath, fileList);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('DEBT-001: Type Safety, Lint Ratchet & Anti-Regression Guards', () => {
  it('1. No .ts/.tsx file under app/, components/, lib/ contains explicit any or unsafe casts', () => {
    const searchDirs = ['app', 'components', 'lib'].map((d) => path.join(ROOT_DIR, d));
    const allFiles = searchDirs.flatMap((d) => walkFiles(d));
    const anyPattern = /(:\s*any\b|\bas any\b|<any>|any\[\])/;

    const violations: { file: string; line: number; snippet: string }[] = [];

    for (const filePath of allFiles) {
      const rawContent = fs.readFileSync(filePath, 'utf8');
      const lines = rawContent.split(/\r?\n/);

      lines.forEach((line, index) => {
        // Strip single line comments to avoid matching prose
        const code = line.replace(/\/\/.*$/, '').trim();
        if (code && anyPattern.test(code)) {
          // If inside a multiline comment block, ignore
          const prefix = rawContent.slice(0, rawContent.indexOf(line));
          const openComments = (prefix.match(/\/\*/g) || []).length;
          const closeComments = (prefix.match(/\*\//g) || []).length;
          if (openComments > closeComments) return;

          violations.push({
            file: path.relative(ROOT_DIR, filePath),
            line: index + 1,
            snippet: code,
          });
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('2. Shared InvoiceLineItem is exported and used across all invoice templates and print view', () => {
    const typesPath = path.join(ROOT_DIR, 'components/app/invoices/templates/types.ts');
    expect(fs.existsSync(typesPath)).toBe(true);

    const typesContent = fs.readFileSync(typesPath, 'utf8');
    expect(typesContent).toMatch(/export\s+(?:interface|type)\s+InvoiceLineItem\b/);

    const templateFiles = [
      'components/app/invoices/invoice-print-view.tsx',
      'components/app/invoices/templates/template-1.tsx',
      'components/app/invoices/templates/template-2.tsx',
      'components/app/invoices/templates/template-3.tsx',
      'components/app/invoices/templates/template-4.tsx',
    ];

    for (const relPath of templateFiles) {
      const content = fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');
      expect(content).not.toMatch(/:\s*any\b/);
      const referencesType = content.includes('InvoiceLineItem') || content.includes('lineItems');
      expect(referencesType).toBe(true);
    }
  });

  it('3. Client components import schema tables only with `import type` to prevent bundle bloat', () => {
    const clientFiles = [
      'components/app/customers/customer-form.tsx',
      'components/app/products/product-actions.tsx',
      'components/app/products/product-form.tsx',
      'components/app/settings/business-profile-form.tsx',
      'components/app/settings/invoice-settings-form.tsx',
      'components/app/settings/settings-client.tsx',
    ];

    for (const relPath of clientFiles) {
      const content = fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');
      expect(content).toMatch(/import\s+type\s+\{[^}]*\}\s+from\s+['"]@\/lib\/db\/schema['"]/);
      expect(content).not.toMatch(/import\s+\{[^}]*\}\s+from\s+['"]@\/lib\/db\/schema['"]/);
    }

    const billingCombined = readComponentSources('components/app/settings/billing-tab.tsx');
    expect(billingCombined).toMatch(/import\s+type\s+\{[^}]*\}\s+from\s+['"]@\/lib\/db\/schema['"]/);
    expect(billingCombined).not.toMatch(/import\s+\{[^}]*\}\s+from\s+['"]@\/lib\/db\/schema['"]/);
  });

  it('4. Components migrated from watch() to useWatch() without watch() calls, and invoice-form has debt comment', () => {
    const migratedFiles = [
      'components/app/invoices/payment-section.tsx',
      'components/app/settings/business-profile-form.tsx',
      'components/app/settings/invoice-settings-form.tsx',
    ];

    for (const relPath of migratedFiles) {
      const content = fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');
      expect(content).toContain('useWatch');
      const stripped = stripComments(content);
      expect(stripped).not.toMatch(/\bwatch\(/);
    }

    const invoiceFormCombined = readComponentSources('components/app/invoices/invoice-form.tsx');
    expect(invoiceFormCombined).toContain('useWatch');
    const strippedInvoiceForm = stripComments(invoiceFormCombined);
    expect(strippedInvoiceForm).not.toMatch(/\bwatch\(/);
  });

  it('reviewer: a saved draft unit is passed to the form unchanged (never silently rewritten)', () => {
    const page = fs.readFileSync(path.resolve(process.cwd(), 'app/(app)/invoices/[id]/page.tsx'), 'utf8');
    expect(page).toMatch(/unit_of_measurement:\s*li\.unit_of_measurement\b/);
    // No coercion like `isOneOf(...) ? li.unit_of_measurement : 'NOS'` on the unit line.
    const unitLine = page.split(/\r?\n/).find((l) => l.includes('unit_of_measurement:')) ?? '';
    expect(unitLine).not.toContain("'NOS'");
    const form = readComponentSources('components/app/invoices/invoice-form.tsx');
    expect(form).toContain('export type InvoiceFormInitialLine');
  });

  it('reviewer: invoice-form search failures are not silently swallowed', () => {
    const form = readComponentSources('components/app/invoices/invoice-form.tsx');
    expect(form).not.toContain('// search failed');
  });
});
