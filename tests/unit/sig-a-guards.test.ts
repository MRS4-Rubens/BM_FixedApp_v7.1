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

describe('SPEC: Authorised signature architecture guards (SIG-A)', () => {
  const targetDirs = ['app', 'components', 'lib'];
  const allFiles = targetDirs.flatMap((d) => walkFiles(d));

  it('1. no file under app/, components/, lib/ builds a URL containing "signatures/" (except lib/storage/signature.ts)', () => {
    // Regex matching URL construction targeting signatures (e.g. /api/...signatures/, http...signatures/, build...Url...signatures)
    const urlPattern = /(?:https?:\/\/[^\s'"`]*signatures\/|\/api\/[^\s'"`]*signatures\/|build[A-Za-z0-9_]*Url[^\s;]*signatures)/i;
    const violations: Array<{ file: string; match: string }> = [];

    for (const file of allFiles) {
      const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
      if (rel === 'lib/storage/signature.ts') {
        continue;
      }

      const content = fs.readFileSync(file, 'utf-8');
      const match = content.match(urlPattern);
      if (match) {
        violations.push({ file: rel, match: match[0] });
      }
    }

    expect(violations).toEqual([]);
  });

  it('2. no signature HTTP route handler exists under app/api', () => {
    const apiFiles = walkFiles('app/api');
    const signatureRoutes = apiFiles.filter((f) => {
      const rel = path.relative(ROOT_DIR, f).replace(/\\/g, '/');
      return rel.toLowerCase().includes('signature');
    });
    expect(signatureRoutes).toEqual([]);
  });

  it('3. the logo route source still only accepts logo keys and never imports lib/storage/signature', () => {
    const logoRoutePath = path.resolve(ROOT_DIR, 'app/api/business/[id]/logo/route.ts');
    expect(fs.existsSync(logoRoutePath)).toBe(true);

    const content = fs.readFileSync(logoRoutePath, 'utf-8');
    expect(content).not.toMatch(/lib\/storage\/signature/);
    expect(content).not.toMatch(/signature/i);
  });

  it('4. upload-signature.ts has no entitlement or plan check', () => {
    const uploadSignaturePath = path.resolve(ROOT_DIR, 'lib/actions/business/upload-signature.ts');
    expect(fs.existsSync(uploadSignaturePath)).toBe(true);

    const content = fs.readFileSync(uploadSignaturePath, 'utf-8');
    expect(content).not.toMatch(/canUpload/);
    expect(content).not.toMatch(/entitlement/i);
    expect(content).not.toMatch(/PLAN_SOURCE_COLUMNS/);
    expect(content).not.toMatch(/subscription_plan/);
  });

  it('4b. both signature actions are blocked for suspended businesses (suspended = read-only, Policy P2)', () => {
    // "All plans" means no plan gate; it does NOT mean a suspended business may change its documents' signature.
    for (const rel of ['lib/actions/business/upload-signature.ts', 'lib/actions/business/remove-signature.ts']) {
      const content = fs.readFileSync(path.resolve(ROOT_DIR, rel), 'utf-8');
      expect(content, rel).toMatch(/requireActiveSubscription:\s*true/);
    }
  });

  it('5. the words "digital signature" do not appear anywhere in app/, components/, lib/ (case-insensitive)', () => {
    const violations: Array<{ file: string; line: number; match: string }> = [];

    for (const file of allFiles) {
      const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/digital\s+signature/i.test(line)) {
          violations.push({ file: rel, line: i + 1, match: line.trim() });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

