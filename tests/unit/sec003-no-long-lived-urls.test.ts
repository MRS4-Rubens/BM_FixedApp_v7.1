import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      results.push(...collectFiles(full));
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

describe('SEC-003: No long-lived signed URLs static tripwire', () => {
  const root = process.cwd();

  it('ensures no source file under lib/ or app/ contains 604800 (7-day presigned expiry)', () => {
    const searchDirs = [join(root, 'lib'), join(root, 'app')];
    const files = searchDirs.flatMap((d) => collectFiles(d));

    const offenders: string[] = [];
    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf8');
      if (content.includes('604800')) {
        offenders.push(filePath.replace(root, ''));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('ensures app/(admin)/admin/page.tsx does not import storage or getSignedDownloadUrl', () => {
    const adminPage = readFileSync(join(root, 'app', '(admin)', 'admin', 'page.tsx'), 'utf8');
    expect(adminPage).not.toContain('@/lib/storage/idrive');
    expect(adminPage).not.toContain('getSignedDownloadUrl');
  });

  it('ensures subscription-request-email.tsx has no screenshotUrl property or references', () => {
    const emailFile = readFileSync(
      join(root, 'lib', 'email', 'templates', 'subscription-request-email.tsx'),
      'utf8'
    );
    expect(emailFile).not.toContain('screenshotUrl');
  });
});

