import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT_DIR = process.cwd();

function walkFiles(dir: string, extensions = ['.ts', '.tsx']): string[] {
  const fullPath = path.resolve(ROOT_DIR, dir);
  if (!fs.existsSync(fullPath)) return [];

  const results: string[] = [];
  function recurse(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        recurse(entryPath);
      } else if (
        extensions.some((ext) => entry.name.endsWith(ext)) &&
        !entry.name.endsWith('.d.ts')
      ) {
        results.push(entryPath);
      }
    }
  }
  recurse(fullPath);
  return results;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

describe('P3-WRAPUP Guard Tests', () => {
  it('1. No alert, confirm, or prompt calls exist anywhere in app/, components/, or lib/', () => {
    const targetDirs = ['app', 'components', 'lib'];
    const allFiles = targetDirs.flatMap((d) => walkFiles(d));
    const violations: Array<{ file: string; match: string }> = [];

    const callRegex = /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/;

    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const stripped = stripComments(content);

      if (callRegex.test(stripped)) {
        const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
        const match = stripped.match(callRegex)?.[0] ?? '';
        violations.push({ file: rel, match });
      }
    }

    expect(violations).toEqual([]);
  });

  it('2. window.open( appears ONLY in lib/pdf/open-signed-pdf.ts and invoice-detail.tsx WhatsApp share', () => {
    const targetDirs = ['app', 'components', 'lib'];
    const allFiles = targetDirs.flatMap((d) => walkFiles(d));
    const occurrences: Array<{ file: string; line: number; snippet: string }> = [];

    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split(/\r?\n/);
      const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');

      lines.forEach((line, idx) => {
        const strippedLine = line.replace(/\/\/.*$/, '').trim();
        if (strippedLine.includes('window.open(')) {
          occurrences.push({
            file: rel,
            line: idx + 1,
            snippet: strippedLine,
          });
        }
      });
    }

    // Must appear only in lib/pdf/open-signed-pdf.ts and components/app/invoices/invoice-detail.tsx
    const allowedFiles = new Set([
      'lib/pdf/open-signed-pdf.ts',
      'components/app/invoices/invoice-detail.tsx',
    ]);

    for (const occ of occurrences) {
      expect(allowedFiles.has(occ.file), `Unexpected window.open in ${occ.file}:${occ.line}`).toBe(true);
      if (occ.file === 'components/app/invoices/invoice-detail.tsx') {
        expect(occ.snippet).toContain('shareUrl');
      }
    }

    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('3. All 6 PDF download sites invoke openSignedPdf', () => {
    const clientPath = path.resolve(ROOT_DIR, 'app/(app)/invoices/client.tsx');
    const invoiceDetailPath = path.resolve(ROOT_DIR, 'components/app/invoices/invoice-detail.tsx');
    const creditNoteDetailPath = path.resolve(ROOT_DIR, 'components/app/credit-notes/credit-note-detail.tsx');

    const clientSrc = fs.readFileSync(clientPath, 'utf-8');
    const invoiceDetailSrc = fs.readFileSync(invoiceDetailPath, 'utf-8');
    const creditNoteDetailSrc = fs.readFileSync(creditNoteDetailPath, 'utf-8');

    // 4 in client.tsx
    const clientMatches = clientSrc.match(/openSignedPdf\s*\(/g) || [];
    expect(clientMatches.length).toBe(4);

    // 1 in invoice-detail.tsx
    const invMatches = invoiceDetailSrc.match(/openSignedPdf\s*\(/g) || [];
    expect(invMatches.length).toBe(1);

    // 1 in credit-note-detail.tsx
    const cnMatches = creditNoteDetailSrc.match(/openSignedPdf\s*\(/g) || [];
    expect(cnMatches.length).toBe(1);
  });

  it('4. DeleteDraftButtonProps.onError is required and all <DeleteDraftButton usages pass onError=', () => {
    const buttonSrcPath = path.resolve(ROOT_DIR, 'components/app/invoices/delete-draft-button.tsx');
    const buttonSrc = fs.readFileSync(buttonSrcPath, 'utf-8');

    // Required onError without '?'
    expect(buttonSrc).toMatch(/readonly\s+onError:\s*\(message:\s*string\)\s*=>\s*void;/);
    expect(buttonSrc).not.toMatch(/readonly\s+onError\?:\s*\(message:\s*string\)\s*=>\s*void;/);

    // Check all usages across the repository
    const allFiles = ['app', 'components'].flatMap((d) => walkFiles(d));
    let totalUsages = 0;

    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const matches = content.match(/<DeleteDraftButton\b[^>]*>/g);
      if (matches) {
        for (const tag of matches) {
          totalUsages++;
          expect(tag, `Usage in ${file} missing onError=`).toContain('onError=');
        }
      }
    }

    // 2 in client.tsx + 1 in invoice-form.tsx
    expect(totalUsages).toBe(3);
  });

  it('5. Templates 1-4 and credit-note-print-view use amountInWordsFromPaise and contain no grand_total_paise % 100', () => {
    const templatePaths = [
      'components/app/invoices/templates/template-1.tsx',
      'components/app/invoices/templates/template-2.tsx',
      'components/app/invoices/templates/template-3.tsx',
      'components/app/invoices/templates/template-4.tsx',
      'components/app/credit-notes/credit-note-print-view.tsx',
    ];

    for (const rel of templatePaths) {
      const src = fs.readFileSync(path.resolve(ROOT_DIR, rel), 'utf-8');
      expect(src, `${rel} must import amountInWordsFromPaise`).toContain('amountInWordsFromPaise');
      expect(src, `${rel} must call amountInWordsFromPaise`).toMatch(/amountInWordsFromPaise\([^)]*grand_total_paise/);
      expect(src, `${rel} must not contain grand_total_paise % 100`).not.toContain('grand_total_paise % 100');
    }
  });
});

