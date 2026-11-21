import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SIGNATURE_MAX_BYTES } from '@/lib/security/signature-limits';

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

describe('SPEC: Signature settings screen architecture guards (SIG-B1)', () => {
  it('1. in invoice-settings-form.tsx the row order satisfies: "Show Invoice Running Number" < "Fixed Table Rows (Table Padding)" < "Authorised Signatory Section"', () => {
    const filePath = path.resolve(ROOT_DIR, 'components/app/settings/invoice-settings-form.tsx');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf-8');
    const runningNoIdx = content.indexOf('Show Invoice Running Number');
    const fixedRowsIdx = content.indexOf('Fixed Table Rows (Table Padding)');
    const signatoryIdx = content.indexOf('Authorised Signatory Section');

    expect(runningNoIdx).toBeGreaterThan(-1);
    expect(fixedRowsIdx).toBeGreaterThan(-1);
    expect(signatoryIdx).toBeGreaterThan(-1);

    expect(runningNoIdx).toBeLessThan(fixedRowsIdx);
    expect(fixedRowsIdx).toBeLessThan(signatoryIdx);
  });

  it('2. "Target Table Row Count" appears AFTER "Fixed Table Rows (Table Padding)" and BEFORE "Authorised Signatory Section"', () => {
    const filePath = path.resolve(ROOT_DIR, 'components/app/settings/invoice-settings-form.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    const fixedRowsIdx = content.indexOf('Fixed Table Rows (Table Padding)');
    const rowCountIdx = content.indexOf('Target Table Row Count');
    const signatoryIdx = content.indexOf('Authorised Signatory Section');

    expect(rowCountIdx).toBeGreaterThan(-1);
    expect(fixedRowsIdx).toBeLessThan(rowCountIdx);
    expect(rowCountIdx).toBeLessThan(signatoryIdx);
  });

  it('3. signature-settings-panel.tsx and signature-upload-modal.tsx import uploadBusinessSignature/removeBusinessSignature and do NOT import from lib/security/signature-image or lib/storage/', () => {
    const panelPath = path.resolve(ROOT_DIR, 'components/app/settings/signature-settings-panel.tsx');
    const modalPath = path.resolve(ROOT_DIR, 'components/app/settings/signature-upload-modal.tsx');

    expect(fs.existsSync(panelPath)).toBe(true);
    expect(fs.existsSync(modalPath)).toBe(true);

    const panelContent = fs.readFileSync(panelPath, 'utf-8');
    const modalContent = fs.readFileSync(modalPath, 'utf-8');

    expect(panelContent).toMatch(/removeBusinessSignature/);
    expect(modalContent).toMatch(/uploadBusinessSignature/);

    expect(panelContent).not.toMatch(/lib\/security\/signature-image/);
    expect(panelContent).not.toMatch(/lib\/storage/);

    expect(modalContent).not.toMatch(/lib\/security\/signature-image/);
    expect(modalContent).not.toMatch(/lib\/storage/);
  });

  it('4. no file under components/ imports @/lib/storage/signature (server-only)', () => {
    const componentFiles = walkFiles('components');
    const violations: string[] = [];

    for (const file of componentFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      if (
        content.includes('lib/storage/signature') ||
        content.includes('@/lib/storage/signature')
      ) {
        violations.push(path.relative(ROOT_DIR, file).replace(/\\/g, '/'));
      }
    }

    expect(violations).toEqual([]);
  });

  it('5. lib/signature/process-signature.ts contains no "document.", "window.", or "\'use client\'"', () => {
    const procPath = path.resolve(ROOT_DIR, 'lib/signature/process-signature.ts');
    expect(fs.existsSync(procPath)).toBe(true);

    const content = fs.readFileSync(procPath, 'utf-8');
    expect(content).not.toMatch(/document\./);
    expect(content).not.toMatch(/window\./);
    expect(content).not.toMatch(/['"]use client['"]/);
  });

  it('6. lib/security/signature-limits.ts exists and SIGNATURE_MAX_BYTES equals 20 * 1024 (B9b)', () => {
    const limitsPath = path.resolve(ROOT_DIR, 'lib/security/signature-limits.ts');
    expect(fs.existsSync(limitsPath)).toBe(true);

    expect(SIGNATURE_MAX_BYTES).toBe(20 * 1024);
  });
});

