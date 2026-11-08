import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function walkDir(dir: string, fileList: string[] = []): string[] {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (
      entry === 'node_modules' ||
      entry === '.next' ||
      entry === '.git' ||
      entry === '.claude' ||
      entry === 'dist' ||
      entry === 'coverage'
    ) {
      continue;
    }
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath, fileList);
    } else if (stat.isFile()) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function isClientComponent(content: string): boolean {
  const lines = content.split('\n');
  let inBlockComment = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (inBlockComment) {
      if (line.includes('*/')) {
        inBlockComment = false;
      }
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) {
        inBlockComment = true;
      }
      continue;
    }
    if (line.startsWith('//')) {
      continue;
    }
    // First non-empty, non-comment line
    return /^['"]use client['"]/.test(line);
  }
  return false;
}

const ROOT_DIR = process.cwd();

const ALLOWLIST = new Set([
  'lib/actions/_shared/logger.ts',
  'lib/env-boot.ts',
  'lib/db/seed.ts',
]);

const CONSOLE_METHOD_PATTERN = /\bconsole\.(log|error|warn|info|debug)\(/;

describe('SEC-006: Server-side console bypass guard', () => {
  it('ensures no server-side files in app/, lib/, components/ bypass the central logger', () => {
    const targetDirs = ['app', 'lib', 'components'].map((d) => join(ROOT_DIR, d));
    const allFiles = targetDirs.flatMap((d) => walkDir(d));

    const offendingFiles: string[] = [];

    for (const file of allFiles) {
      if (!file.endsWith('.ts') && !file.endsWith('.tsx')) {
        continue;
      }
      const relPath = relative(ROOT_DIR, file).replace(/\\/g, '/');
      if (ALLOWLIST.has(relPath)) {
        continue;
      }

      const content = readFileSync(file, 'utf8');
      if (isClientComponent(content)) {
        continue;
      }

      if (CONSOLE_METHOD_PATTERN.test(content)) {
        offendingFiles.push(relPath);
      }
    }

    expect(
      offendingFiles,
      `Offending server files using unmanaged console.* calls: ${offendingFiles.join(', ')}`,
    ).toEqual([]);
  });
});

