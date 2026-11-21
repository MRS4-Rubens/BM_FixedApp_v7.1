import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { readComponentSources } from '../helpers/component-sources';

describe('FE-004: Accessibility (WCAG 2.1 AA) guards', () => {
  const rootDir = process.cwd();

  const getSourceFiles = (dirs: string[]): string[] => {
    const files: string[] = [];

    const walk = (current: string) => {
      if (!existsSync(current)) return;
      const stat = statSync(current);
      if (stat.isDirectory()) {
        for (const child of readdirSync(current)) {
          walk(join(current, child));
        }
      } else if (/\.(tsx?|jsx?)$/.test(current)) {
        files.push(current);
      }
    };

    for (const dir of dirs) {
      walk(resolve(rootDir, dir));
    }
    return files;
  };

  it('ensures zero native confirm() or window.confirm() calls in app/ and components/', () => {
    const files = getSourceFiles(['app', 'components']);
    const violations: { file: string; line: number; match: string }[] = [];

    const confirmRegex = /\b(?:window\.)?confirm\s*\(/;

    for (const filePath of files) {
      const relPath = relative(rootDir, filePath).replace(/\\/g, '/');
      // Exclude confirm-dialog component itself if any reference exists
      if (relPath === 'components/ui/confirm-dialog.tsx') continue;

      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // Ignore comments
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;

        if (confirmRegex.test(line)) {
          violations.push({
            file: relPath,
            line: index + 1,
            match: line.trim(),
          });
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('ensures no text-muted-foreground opacity variants on text elements in app/ and components/', () => {
    const files = getSourceFiles(['app', 'components']);
    const violations: { file: string; line: number; match: string }[] = [];

    // Match text-muted-foreground/(50|60|70|80|90) not preceded by placeholder:
    const opacityRegex = /(?<!placeholder:)\btext-muted-foreground\/(?:50|60|70|80|90)\b/;
    // Check whether the line is purely an icon self-closing tag or SVG
    const isIconLine = (line: string): boolean => {
      const trimmed = line.trim();
      // Self-closing icon tags like <Search ... />, <ChevronsUpDown ... />, <MapPin ... />
      return /^<[A-Z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)?\s+[^>]*\/>$/.test(trimmed) ||
             /^<svg\b[^>]*>.*<\/svg>$/.test(trimmed) ||
             /<(Search|ChevronsUpDown|MapPin|Phone|PackageOpen)\b[^>]*\/>/.test(trimmed);
    };

    for (const filePath of files) {
      const relPath = relative(rootDir, filePath).replace(/\\/g, '/');
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;

        if (opacityRegex.test(line)) {
          if (!isIconLine(line)) {
            violations.push({
              file: relPath,
              line: index + 1,
              match: line.trim(),
            });
          }
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('ensures app/globals.css defines --success-text token and theme mapping', () => {
    const globalsPath = resolve(rootDir, 'app/globals.css');
    expect(existsSync(globalsPath)).toBe(true);

    const content = readFileSync(globalsPath, 'utf8');
    expect(content).toContain('--success-text: oklch(0.47 0.12 162);');
    expect(content).toContain('--color-success-text: var(--success-text);');
  });

  it('ensures ConfirmDialog component is exported and utilizes @base-ui/react/alert-dialog', () => {
    const dialogPath = resolve(rootDir, 'components/ui/confirm-dialog.tsx');
    expect(existsSync(dialogPath)).toBe(true);

    const content = readFileSync(dialogPath, 'utf8');
    expect(content).toContain('@base-ui/react/alert-dialog');
    expect(content).toContain('export function ConfirmDialog');
  });

  // Line reordering uses ONE control: the grip handle. It must stay keyboard- and screen-reader-usable
  // (focusable, labelled, ↑ ↓ keys, hint + live announcement), because the separate ↑/↓ buttons were removed.
  it('ensures the grip handle supports keyboard line reordering in components/app/invoices/invoice-form.tsx', () => {
    const formPath = resolve(rootDir, 'components/app/invoices/invoice-form.tsx');
    expect(existsSync(formPath)).toBe(true);

    const content = readComponentSources('components/app/invoices/invoice-form.tsx');
    expect(content).toContain('role="button"');
    expect(content).toContain('tabIndex={canReorder ? 0 : -1}');
    expect(content).toContain('Reorder line ${idx + 1}');
    expect(content).toContain('onKeyDown');
    expect(content).toContain('reorderTargetForKey(e.key, idx, fieldsLength)');
    expect(content).toContain('handleMoveLine');
    expect(content).toContain('aria-describedby={canReorder ? LINE_REORDER_HINT_ID : undefined}');
    expect(content).toContain('id={LINE_REORDER_STATUS_ID} role="status" aria-live="polite"');
    // The old duplicate arrow buttons must not come back.
    expect(content).not.toContain('move-line-up-');
    expect(content).not.toContain('move-line-down-');
  });
});
