import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

describe('FE-005 Architecture & Security Guards', () => {
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
      } else if (/\.(tsx?|jsx?|mjs)$/.test(current)) {
        files.push(current);
      }
    };

    for (const dir of dirs) {
      walk(resolve(rootDir, dir));
    }
    return files;
  };

  it('ensures no third-party QR generation domains exist in app/, components/, or lib/', () => {
    const files = getSourceFiles(['app', 'components', 'lib']);
    const forbiddenDomains = ['qrserver.com', 'chart.googleapis.com', 'quickchart.io'];
    const violations: { file: string; line: number; domain: string }[] = [];

    for (const filePath of files) {
      const relPath = relative(rootDir, filePath).replace(/\\/g, '/');
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        for (const domain of forbiddenDomains) {
          if (line.includes(domain)) {
            violations.push({
              file: relPath,
              line: index + 1,
              domain,
            });
          }
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it("ensures no 'use client' file imports or requires 'qrcode'", () => {
    const files = getSourceFiles(['app', 'components', 'lib']);
    const violations: { file: string; importStatement: string }[] = [];

    const qrcodeImportRegex = /(?:import\s+.*?\s+from\s+['"]qrcode['"]|require\(['"]qrcode['"]\))/;

    for (const filePath of files) {
      const relPath = relative(rootDir, filePath).replace(/\\/g, '/');
      const content = readFileSync(filePath, 'utf8');

      // Check if file is a client component
      const isClientComponent = /^\s*['"]use client['"]/m.test(content);
      if (isClientComponent) {
        const match = content.match(qrcodeImportRegex);
        if (match) {
          violations.push({
            file: relPath,
            importStatement: match[0],
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

