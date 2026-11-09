import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readComponentSources } from '../helpers/component-sources';

const ROOT_DIR = process.cwd();

function walkFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir);
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
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkFiles(fullPath, fileList);
    } else if (stat.isFile()) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('CLEAN-SWEEP: Architecture, Dead Code, and Documentation Guards', () => {
  it('1. asserts deleted and moved files do not exist at their old paths', () => {
    const deletedOrMovedPaths = [
      'components/app/app-brand-logo.tsx',
      'lib/storage/archive-invoice.ts',
      'lib/storage/archive-credit-note.ts',
      'docs/SUBSCRIPTION_MANUAL_VERIFICATION_SCRATCHPAD.md',
      'docs/TEST-001-findings.md',
      'docs/TEST-001-report.md',
    ];

    for (const relPath of deletedOrMovedPaths) {
      const fullPath = path.resolve(ROOT_DIR, relPath);
      expect(fs.existsSync(fullPath), `Expected ${relPath} to not exist`).toBe(false);
    }

    // Moved destinations must exist
    expect(fs.existsSync(path.resolve(ROOT_DIR, 'docs/reports/TEST-001-findings.md'))).toBe(true);
    expect(fs.existsSync(path.resolve(ROOT_DIR, 'docs/reports/TEST-001-completion.md'))).toBe(true);
  });

  it('2. zero occurrences of storage/archive-invoice or storage/archive-credit-note across app/, components/, lib/, tests/, e2e/', () => {
    const searchDirs = ['app', 'components', 'lib', 'tests', 'e2e'].map((d) =>
      path.join(ROOT_DIR, d),
    );
    const allFiles = searchDirs.flatMap((d) => walkFiles(d));

    const matches: string[] = [];
    for (const file of allFiles) {
      // Exclude this guard test itself
      if (file.endsWith('clean-sweep-guards.test.ts')) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (
        content.includes('storage/archive-invoice') ||
        content.includes('storage/archive-credit-note')
      ) {
        matches.push(path.relative(ROOT_DIR, file).replace(/\\/g, '/'));
      }
    }

    expect(matches).toEqual([]);
  });

  it('3. @tanstack/react-query stays a direct dependency (required peer of the Neon Auth UI stack) and is documented', () => {
    // Reviewer decision: our code never imports it, but @daveyplate/better-auth-tanstack / better-auth-ui
    // (pulled in by @neondatabase/auth) declare it as a required peer. Relying on pnpm auto-installing peers is fragile.
    const pkg = JSON.parse(fs.readFileSync(path.resolve(ROOT_DIR, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['@tanstack/react-query']).toBeTruthy();
    const deps = fs.readFileSync(path.resolve(ROOT_DIR, 'docs/security/dependencies.md'), 'utf8');
    expect(deps).toContain('@tanstack/react-query');
  });

  it('4. README.md and ARCHITECTURE.md contain none of the banned legacy strings', () => {
    const banned = [
      'BM_TS_v2.0.1C',
      'BillMatrix_Backend_Roadmap',
      'ping.ts',
      'lib/db/scripts',
      'file:///',
    ];

    for (const doc of ['README.md', 'ARCHITECTURE.md']) {
      const content = fs.readFileSync(path.resolve(ROOT_DIR, doc), 'utf8');
      for (const term of banned) {
        expect(content.includes(term), `Expected ${doc} not to contain "${term}"`).toBe(false);
      }
    }
  });

  it('5. every backtick-quoted or markdown-linked path in README.md and ARCHITECTURE.md exists on disk', () => {
    const prefixes = [
      'lib/',
      'app/',
      'components/',
      'scripts/',
      'docs/',
      'tests/',
      'e2e/',
      'security/',
      'patches/',
    ];

    for (const doc of ['README.md', 'ARCHITECTURE.md']) {
      const text = fs.readFileSync(path.resolve(ROOT_DIR, doc), 'utf8');
      const candidates = new Set<string>();

      // Backtick quoted
      const backtickRegex = /`([^`\n]+)`/g;
      let m: RegExpExecArray | null;
      while ((m = backtickRegex.exec(text)) !== null) {
        const s = m[1].trim();
        if (prefixes.some((p) => s.startsWith(p))) candidates.add(s);
      }

      // Markdown links [text](path)
      const linkRegex = /\[[^\]]+\]\(([^)\n]+)\)/g;
      while ((m = linkRegex.exec(text)) !== null) {
        const s = m[1].trim();
        if (prefixes.some((p) => s.startsWith(p))) candidates.add(s);
      }

      const missing: string[] = [];
      for (const c of candidates) {
        let clean = c.split('#')[0].split('?')[0];
        clean = decodeURIComponent(clean);
        if (
          clean.includes('*') ||
          clean.includes('...') ||
          clean.includes('<') ||
          clean.includes('[') ||
          clean.includes('{') ||
          clean.includes('$')
        ) {
          continue;
        }
        clean = clean.replace(/[.,:;]$/, '');
        if (!fs.existsSync(path.resolve(ROOT_DIR, clean))) {
          missing.push(c);
        }
      }

      expect(missing, `Broken paths found in ${doc}: ${JSON.stringify(missing)}`).toEqual([]);
    }
  });

  it('6. .env.example has no EMAIL_FROM_ADDRESS / EMAIL_FROM_NAME and .gitignore has no __v0_', () => {
    const envExample = fs.readFileSync(path.resolve(ROOT_DIR, '.env.example'), 'utf8');
    expect(envExample).not.toContain('EMAIL_FROM_ADDRESS');
    expect(envExample).not.toContain('EMAIL_FROM_NAME');

    const gitignore = fs.readFileSync(path.resolve(ROOT_DIR, '.gitignore'), 'utf8');
    expect(gitignore).not.toContain('__v0_');
  });

  it('7. .github/workflows/e2e.yml has a job with needs: config and if: needs.config.outputs.configured, with no steps.config.outputs.configured', () => {
    const workflow = fs.readFileSync(path.resolve(ROOT_DIR, '.github/workflows/e2e.yml'), 'utf8');
    expect(workflow).toContain('needs: config');
    expect(workflow).toContain("if: needs.config.outputs.configured == 'true'");
    expect(workflow).not.toContain('steps.config.outputs.configured');
  });

  it('8. admin-console.tsx imports BusinessIdentityDialog, business-identity-dialog.tsx calls adminUpdateBusinessIdentity, and business-directory.ts selects state_code', () => {
    const adminConsole = readComponentSources('app/(admin)/admin/admin-console.tsx');
    expect(adminConsole).toContain('BusinessIdentityDialog');

    const dialog = fs.readFileSync(
      path.resolve(ROOT_DIR, 'app/(admin)/admin/business-identity-dialog.tsx'),
      'utf8',
    );
    expect(dialog).toContain('adminUpdateBusinessIdentity');

    const businessDir = fs.readFileSync(
      path.resolve(ROOT_DIR, 'lib/subscriptions/business-directory.ts'),
      'utf8',
    );
    expect(businessDir).toContain('state_code');
  });

  it('9. billing-tab.tsx has no "Live Database Sync", and contains canShareInvoiceOnWhatsApp and canExportStatutoryReport', () => {
    const billingTab = readComponentSources('components/app/settings/billing-tab.tsx');
    expect(billingTab).not.toContain('Live Database Sync');
    expect(billingTab).toContain('canShareInvoiceOnWhatsApp');
    expect(billingTab).toContain('canExportStatutoryReport');
  });
});

