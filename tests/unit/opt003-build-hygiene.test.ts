import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('OPT-003: Build & Dependency Hygiene Guards', () => {
  const rootDir = process.cwd();

  it('asserts tsconfig.json compilerOptions.target is ES2022', () => {
    const tsconfigPath = path.join(rootDir, 'tsconfig.json');
    const tsconfigContent = fs.readFileSync(tsconfigPath, 'utf8');
    const tsconfig = JSON.parse(tsconfigContent);

    expect(tsconfig.compilerOptions?.target).toBe('ES2022');
  });

  it('asserts package.json engines.node is 24.x and matches the major version in .nvmrc', () => {
    const packageJsonPath = path.join(rootDir, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    const enginesNode = packageJson.engines?.node;
    expect(enginesNode, 'package.json engines.node must be 24.x').toBe('24.x');

    const nvmrcPath = path.join(rootDir, '.nvmrc');
    const nvmrcContent = fs.readFileSync(nvmrcPath, 'utf8').trim();
    const nvmrcMajor = nvmrcContent.match(/^v?(\d+)/)?.[1];
    expect(nvmrcMajor, '.nvmrc must specify a major version').toBeDefined();

    const enginesMajor = enginesNode.match(/^(\d+)/)?.[1];
    expect(enginesMajor, 'engines.node major must match .nvmrc major').toBe(nvmrcMajor);
  });

  it('asserts next.config.mjs has no unoptimized images setting and allowedDevOrigins entries contain no port', () => {
    const nextConfigPath = path.join(rootDir, 'next.config.mjs');
    const nextConfigContent = fs.readFileSync(nextConfigPath, 'utf8');

    expect(
      nextConfigContent.includes('unoptimized'),
      'next.config.mjs must not contain "unoptimized" setting',
    ).toBe(false);

    const originsMatch = nextConfigContent.match(/allowedDevOrigins:\s*\[([\s\S]*?)\]/);
    expect(originsMatch, 'allowedDevOrigins must be defined in next.config.mjs').not.toBeNull();

    const origins = [...originsMatch![1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(origins.length).toBeGreaterThan(0);

    for (const origin of origins) {
      expect(
        origin,
        `allowedDevOrigins entry "${origin}" must not contain a port (Next matches hostnames only)`,
      ).not.toContain(':');
    }
  });

  it('asserts no file under app/, components/, or lib/ imports next/image', () => {
    function getSourceFiles(dir: string): string[] {
      const fullDir = path.join(rootDir, dir);
      if (!fs.existsSync(fullDir)) return [];
      const entries = fs.readdirSync(fullDir, { withFileTypes: true });
      const files: string[] = [];

      for (const entry of entries) {
        const fullPath = path.join(fullDir, entry.name);
        if (entry.isDirectory()) {
          files.push(...getSourceFiles(path.join(dir, entry.name)));
        } else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(entry.name)) {
          files.push(fullPath);
        }
      }

      return files;
    }

    const filesToCheck = [
      ...getSourceFiles('app'),
      ...getSourceFiles('components'),
      ...getSourceFiles('lib'),
    ];

    expect(filesToCheck.length).toBeGreaterThan(0);

    const violatingFiles: string[] = [];
    for (const file of filesToCheck) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes("from 'next/image'") || content.includes('from "next/image"') || content.includes("import('next/image')")) {
        violatingFiles.push(path.relative(rootDir, file));
      }
    }

    expect(
      violatingFiles,
      'add images.remotePatterns and update docs/DEPLOYMENT.md OPT-003 section, then update this test',
    ).toEqual([]);
  });

  it('asserts docs/DEPLOYMENT.md contains the heading "Build configuration decisions (OPT-003)"', () => {
    const deploymentDocPath = path.join(rootDir, 'docs', 'DEPLOYMENT.md');
    const docContent = fs.readFileSync(deploymentDocPath, 'utf8');

    expect(docContent).toContain('## Build configuration decisions (OPT-003)');
  });
});

