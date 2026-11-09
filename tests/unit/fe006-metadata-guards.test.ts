import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('FE-006: Production Metadata, SEO Hygiene & Security Guards', () => {
  const rootDir = process.cwd();

  function getSourceFiles(dir: string): string[] {
    const fullPath = path.resolve(rootDir, dir);
    if (!fs.existsSync(fullPath)) return [];
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const entryPath = path.join(fullPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...getSourceFiles(path.join(dir, entry.name)));
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        files.push(entryPath);
      }
    }

    return files;
  }

  it('asserts no file under app/ or components/ contains dangerouslySetInnerHTML (exception: none)', () => {
    const appFiles = getSourceFiles('app');
    const componentFiles = getSourceFiles('components');
    const allFiles = [...appFiles, ...componentFiles];

    expect(allFiles.length).toBeGreaterThan(0);

    const violatingFiles: string[] = [];
    for (const filePath of allFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes('dangerouslySetInnerHTML')) {
        violatingFiles.push(path.relative(rootDir, filePath));
      }
    }

    expect(
      violatingFiles,
      `No files under app/ or components/ may contain dangerouslySetInnerHTML: found in ${violatingFiles.join(', ')}`,
    ).toEqual([]);
  });

  it('asserts app/layout.tsx has no generator metadata property', () => {
    const layoutPath = path.resolve(rootDir, 'app/layout.tsx');
    const content = fs.readFileSync(layoutPath, 'utf8');

    expect(content).not.toContain('generator');
  });

  it('asserts the robots, sitemap, manifest, opengraph-image and twitter-image routes exist', () => {
    const requiredFiles = [
      'app/robots.ts',
      'app/sitemap.ts',
      'app/manifest.ts',
      'app/opengraph-image.tsx',
      'app/twitter-image.tsx',
    ];

    for (const relPath of requiredFiles) {
      const fullPath = path.resolve(rootDir, relPath);
      expect(fs.existsSync(fullPath), `Expected ${relPath} to exist`).toBe(true);
    }
  });

  it('asserts root metadata defines metadataBase, openGraph, and twitter', () => {
    const layoutPath = path.resolve(rootDir, 'app/layout.tsx');
    const content = fs.readFileSync(layoutPath, 'utf8');

    // Asserts metadata definition contains metadataBase
    expect(content).toMatch(/metadataBase:\s*new URL\(siteOrigin\(\)\)/);

    // Asserts openGraph is defined with required fields
    expect(content).toContain('openGraph:');
    expect(content).toMatch(/type:\s*['"]website['"]/);
    expect(content).toMatch(/siteName:\s*['"]Bill Matrix['"]/);
    expect(content).toMatch(/locale:\s*['"]en_IN['"]/);

    // Asserts twitter is defined with summary_large_image
    expect(content).toContain('twitter:');
    expect(content).toMatch(/card:\s*['"]summary_large_image['"]/);
  });

  it('asserts (app), (admin), and (auth) layouts configure robots with index: false and follow: false', () => {
    const layoutPaths = [
      'app/(app)/layout.tsx',
      'app/(admin)/layout.tsx',
      'app/(auth)/layout.tsx',
    ];

    for (const relPath of layoutPaths) {
      const fullPath = path.resolve(rootDir, relPath);
      expect(fs.existsSync(fullPath), `${relPath} must exist`).toBe(true);

      const content = fs.readFileSync(fullPath, 'utf8');
      expect(content, `${relPath} must export metadata`).toMatch(/export\s+const\s+metadata/);

      // Verify robots configuration contains index: false and follow: false
      const robotsMatch = content.match(/robots:\s*\{([^}]*)\}/);
      expect(robotsMatch, `${relPath} must define robots metadata`).not.toBeNull();

      const robotsBlock = robotsMatch![1];
      expect(robotsBlock, `${relPath} must have index: false`).toMatch(/index:\s*false/);
      expect(robotsBlock, `${relPath} must have follow: false`).toMatch(/follow:\s*false/);
    }
  });
});
