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

describe('SIG-B3 architectural guards', () => {
  it('1. no file under app/, components/, lib/ contains "react-easy-crop"', () => {
    const files = ['app', 'components', 'lib'].flatMap((d) => walkFiles(d));
    const violations: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes('react-easy-crop')) {
        violations.push(path.relative(ROOT_DIR, file).replace(/\\/g, '/'));
      }
    }

    expect(violations).toEqual([]);
  });

  it('2. package.json does not list react-easy-crop', () => {
    const pkgPath = path.resolve(ROOT_DIR, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.peerDependencies || {}),
    };

    expect(allDeps['react-easy-crop']).toBeUndefined();
  });

  it('3. signature-upload-modal.tsx contains none of Cropper, Rotate 90, Background clean-up, radiogroup', () => {
    const modalPath = path.resolve(ROOT_DIR, 'components/app/settings/signature-upload-modal.tsx');
    const content = fs.readFileSync(modalPath, 'utf-8');

    expect(content).not.toContain('Cropper');
    expect(content).not.toContain('Rotate 90');
    expect(content).not.toContain('Background clean-up');
    expect(content.toLowerCase()).not.toContain('radiogroup');
  });

  it('4. signature-settings-panel.tsx imports SIGNATURE_UPLOAD_RULES and CROP_HOW_TO', () => {
    const panelPath = path.resolve(ROOT_DIR, 'components/app/settings/signature-settings-panel.tsx');
    const content = fs.readFileSync(panelPath, 'utf-8');

    expect(content).toMatch(/import\s+.*SIGNATURE_UPLOAD_RULES.*from\s+['"]@\/lib\/signature\/upload-rules['"]/);
    expect(content).toMatch(/import\s+.*CROP_HOW_TO.*from\s+['"]@\/lib\/signature\/upload-rules['"]/);
  });
});

