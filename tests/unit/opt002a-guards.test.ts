import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const PROJECT_ROOT = process.cwd();

function collectSourceFiles(dir: string): string[] {
  const fullDir = path.resolve(PROJECT_ROOT, dir);
  if (!fs.existsSync(fullDir)) return [];
  const results: string[] = [];

  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    const fullPath = path.join(fullDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      results.push(...collectSourceFiles(path.relative(PROJECT_ROOT, fullPath)));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts') &&
      !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('OPT-002a: Codebase and Policy Guard Tests', () => {
  it('verifies components/app/settings/settings-client.tsx contains NO mailto: links and has proper UI text', () => {
    const settingsPath = path.resolve(
      PROJECT_ROOT,
      'components/app/settings/settings-client.tsx',
    );
    const content = fs.readFileSync(settingsPath, 'utf8');
    // The General tab delegates to the extracted account section (kept out of settings-client for size).
    expect(content).not.toContain('mailto:');
    expect(content).toContain('<AccountDataSection');

    const section = fs.readFileSync(
      path.resolve(PROJECT_ROOT, 'components/app/settings/account-data-section.tsx'),
      'utf8',
    );
    expect(section).not.toContain('mailto:');
    expect(section).toContain('Request account closure');
    expect(section).toContain('Download your data');
    expect(section).toContain('8 years');
    expect(section).toContain('href="/api/account/export"');
    // The old irreversible-deletion wording must not come back: closure is a request, statutory records are kept.
    expect(section).not.toContain('This cannot be undone');
  });

  it('verifies app/(marketing)/privacy/page.tsx includes statutory 8-year retention and DPDP self-serve references', () => {
    const privacyPath = path.resolve(
      PROJECT_ROOT,
      'app/(marketing)/privacy/page.tsx',
    );
    const content = fs.readFileSync(privacyPath, 'utf8');

    expect(content).toContain('8 years');
    expect(content).toContain('Download your data');
    expect(content).toContain('within 30 days');
    // No promise of an automatic purge that does not exist yet (statutory purge is a documented manual process).
    expect(content).not.toMatch(/purged automatically/i);
    expect(content).toContain('Request account closure');
  });

  it('verifies no application or library code executes automatic bulk deletion of business records', () => {
    const appFiles = collectSourceFiles('app');
    const libFiles = collectSourceFiles('lib');
    const allFiles = [...appFiles, ...libFiles];

    expect(allFiles.length).toBeGreaterThan(0);

    for (const filePath of allFiles) {
      // Skip generated stylesheets or test files
      if (filePath.includes('print-stylesheet.generated.ts')) continue;

      const content = fs.readFileSync(filePath, 'utf8');

      // Reject raw TRUNCATE SQL queries
      expect(content).not.toMatch(/\bTRUNCATE\s+TABLE\b/i);
      expect(content).not.toMatch(/\bTRUNCATE\s+(businesses|invoices|credit_notes|payments)\b/i);

      // Reject raw DROP TABLE SQL queries
      expect(content).not.toMatch(/\bDROP\s+TABLE\b/i);

      // Reject automated programmatic deletion of businesses
      expect(content).not.toMatch(/db\.delete\s*\(\s*businesses\s*\)/);
      expect(content).not.toMatch(/\bDELETE\s+FROM\s+businesses\b/i);
    }
  });
});

