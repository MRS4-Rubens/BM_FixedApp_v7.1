import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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

describe('SIG-B2 architectural guards', () => {
  const templateFiles = [
    'components/app/invoices/templates/template-1.tsx',
    'components/app/invoices/templates/template-2.tsx',
    'components/app/invoices/templates/template-3.tsx',
    'components/app/invoices/templates/template-4.tsx',
  ];
  const creditNoteFile = 'components/app/credit-notes/credit-note-print-view.tsx';

  it('templates 1–4 and credit-note-print-view.tsx import SignatureMark from signature-mark', () => {
    for (const rel of templateFiles) {
      const content = fs.readFileSync(path.resolve(ROOT_DIR, rel), 'utf-8');
      expect(content).toMatch(/import\s+.*SignatureMark.*from\s+['"]\.\/signature-mark['"]/);
    }

    const cnContent = fs.readFileSync(path.resolve(ROOT_DIR, creditNoteFile), 'utf-8');
    expect(cnContent).toMatch(
      /import\s+.*SignatureMark.*from\s+['"]@\/components\/app\/invoices\/templates\/signature-mark['"]/,
    );
  });

  it('templates 1–4 and credit-note-print-view.tsx do not contain signature_storage_key or signatures/', () => {
    const files = [...templateFiles, creditNoteFile];
    for (const rel of files) {
      const content = fs.readFileSync(path.resolve(ROOT_DIR, rel), 'utf-8');
      expect(content).not.toContain('signature_storage_key');
      expect(content).not.toContain('signatures/');
    }
  });

  it('no file under components/ contains the text "Authorized Signatory"', () => {
    const componentFiles = walkFiles('components');
    const violations: string[] = [];

    for (const file of componentFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes('Authorized Signatory')) {
        violations.push(path.relative(ROOT_DIR, file).replace(/\\/g, '/'));
      }
    }

    expect(violations).toEqual([]);
  });

  it('signature-mark.tsx has no "use client"', () => {
    const markFile = path.resolve(ROOT_DIR, 'components/app/invoices/templates/signature-mark.tsx');
    const content = fs.readFileSync(markFile, 'utf-8');
    expect(content).not.toContain("'use client'");
    expect(content).not.toContain('"use client"');
  });
});

