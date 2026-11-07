import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

function getFilesRecursively(dir: string, baseDir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.claude') {
        continue;
      }
      files.push(...getFilesRecursively(fullPath, baseDir));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('PERF-003 Logo URL Architectural Guards', () => {
  it('asserts no .ts/.tsx file in app/, components/, lib/ builds unversioned/ad-hoc /api/business/${ URLs except lib/storage/logo-url.ts', () => {
    const root = process.cwd();
    const targetDirs = [join(root, 'app'), join(root, 'components'), join(root, 'lib')];
    const allFiles = targetDirs.flatMap((dir) => getFilesRecursively(dir, root));

    const pattern = /\/api\/business\/\$\{/;
    const violatingFiles: string[] = [];

    for (const filePath of allFiles) {
      const relPath = relative(root, filePath).replace(/\\/g, '/');
      if (relPath === 'lib/storage/logo-url.ts') {
        continue;
      }
      const content = readFileSync(filePath, 'utf8');
      if (pattern.test(content)) {
        violatingFiles.push(relPath);
      }
    }

    expect(violatingFiles).toEqual([]);
  });

  it('asserts app/(app)/layout.tsx uses buildLogoUrl', () => {
    const content = readFileSync(join(process.cwd(), 'app/(app)/layout.tsx'), 'utf8');
    expect(content).toContain('buildLogoUrl(');
  });

  it('asserts lib/actions/business/upload-logo.ts uses buildLogoUrl and removes Date.now()', () => {
    const content = readFileSync(join(process.cwd(), 'lib/actions/business/upload-logo.ts'), 'utf8');
    expect(content).toContain('buildLogoUrl(');
    expect(content).not.toContain('Date.now()');
  });
});

