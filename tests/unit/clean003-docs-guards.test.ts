import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

export const IN_SCOPE_DOCS = [
  'README.md',
  'ARCHITECTURE.md',
  'docs/DEPLOYMENT.md',
  'docs/TESTING.md',
  'docs/GST_COMPLIANCE_NOTES.md',
  'docs/STATUTORY_ARCHIVAL_BLUEPRINT.md',
  'docs/e2e-staging-setup.md',
  'docs/security/dependencies.md',
  'e2e/README.md',
] as const;

export const PATH_PREFIXES = [
  'app/',
  'components/',
  'lib/',
  'tests/',
  'e2e/',
  'scripts/',
  'docs/',
  'drizzle/',
  'config/',
  'public/',
  'security/',
  '.github/',
] as const;

export const ROOT_FILES = new Set([
  'proxy.ts',
  'vercel.json',
  'package.json',
  'knip.json',
  'next.config.mjs',
  '.env.example',
  '.nvmrc',
  'drizzle.config.ts',
  'playwright.config.ts',
  'vitest.config.mts',
  'vitest.realdb.config.mts',
  'postcss.config.mjs',
  'tsconfig.json',
  'pnpm-workspace.yaml',
  'docker-compose.test.yml',
  'instrumentation.ts',
  'instrumentation-client.ts',
  'eslint.config.mjs',
]);

export const ALLOWLIST = new Map<string, string>([
  [
    'lib/actions/archival/close-financial-year.ts',
    'Future design proposal documented in docs/STATUTORY_ARCHIVAL_BLUEPRINT.md',
  ],
]);

export const PNPM_BUILTINS = new Set([
  'install',
  'exec',
  'dlx',
  'add',
  'audit',
  'why',
  'up',
  'outdated',
  'remove',
  'update',
  'approve-builds',
  'licenses',
  'store',
]);

function cleanPathToken(rawToken: string): string | null {
  let token = rawToken.trim();
  if (
    /[\*<>\{\}\$…\|]/.test(token) ||
    token.includes('...') ||
    token.includes('/*')
  ) {
    return null;
  }

  // Handle route group parentheses like app/(app) vs trailing punctuation
  const openCount = (token.match(/\(/g) || []).length;
  const closeCount = (token.match(/\)/g) || []).length;
  if (closeCount > openCount) {
    token = token.replace(/\)+$/, '');
  }

  // Strip trailing punctuation
  token = token.replace(/[:;,.'"?\]]+$/, '');
  // Strip :line and #anchor suffixes
  token = token.replace(/:\d+(-\d+)?$/, '');
  token = token.replace(/#.*$/, '');

  const isRepoPath =
    PATH_PREFIXES.some((prefix) => token.startsWith(prefix)) ||
    ROOT_FILES.has(token);

  return isRepoPath ? token : null;
}

describe('CLEAN-003 Living Documentation Guards', () => {
  it('SPEC: all backticked repo paths in living docs must exist on disk (or be allowlisted)', () => {
    const missingPaths: { doc: string; token: string; resolved: string }[] = [];

    for (const doc of IN_SCOPE_DOCS) {
      const docPath = path.join(ROOT, doc);
      expect(fs.existsSync(docPath), `Doc ${doc} must exist`).toBe(true);

      const content = fs.readFileSync(docPath, 'utf8');
      const tokens = [...content.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);

      for (const rawToken of tokens) {
        const clean = cleanPathToken(rawToken);
        if (!clean) continue;

        if (ALLOWLIST.has(clean)) {
          continue;
        }

        const resolved = path.join(ROOT, clean);
        if (!fs.existsSync(resolved)) {
          missingPaths.push({ doc, token: clean, resolved });
        }
      }
    }

    if (missingPaths.length > 0) {
      const summary = missingPaths
        .map((m) => `  - [${m.doc}] Path reference \`${m.token}\` does not exist on disk (${m.resolved})`)
        .join('\n');
      expect.fail(`Found ${missingPaths.length} missing path references in living docs:\n${summary}`);
    }
  });

  it('SPEC: all relative markdown links in living docs must resolve on disk', () => {
    const brokenLinks: { doc: string; label: string; target: string; resolved: string }[] = [];

    for (const doc of IN_SCOPE_DOCS) {
      const docPath = path.join(ROOT, doc);
      const docDir = path.dirname(docPath);
      const content = fs.readFileSync(docPath, 'utf8');

      const matches = [...content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
      for (const match of matches) {
        const label = match[1].trim();
        const rawTarget = match[2].trim();

        if (/^(https?:|mailto:|#)/.test(rawTarget)) continue;

        let linkPath = rawTarget.split('#')[0].split('?')[0];
        if (!linkPath) continue;

        linkPath = decodeURIComponent(linkPath);
        const resolved = path.resolve(docDir, linkPath);

        if (!fs.existsSync(resolved)) {
          brokenLinks.push({ doc, label, target: rawTarget, resolved });
        }
      }
    }

    if (brokenLinks.length > 0) {
      const summary = brokenLinks
        .map((b) => `  - [${b.doc}] Link [${b.label}](${b.target}) -> resolved to missing: ${b.resolved}`)
        .join('\n');
      expect.fail(`Found ${brokenLinks.length} broken markdown links in living docs:\n${summary}`);
    }
  });

  it('SPEC: every pnpm <name> referenced in living docs must be a package.json script or built-in', () => {
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
    );
    const pkgScripts = new Set(Object.keys(pkgJson.scripts || {}));
    const invalidCommands: { doc: string; command: string }[] = [];

    for (const doc of IN_SCOPE_DOCS) {
      const docPath = path.join(ROOT, doc);
      const content = fs.readFileSync(docPath, 'utf8');

      const matches = [
        ...content.matchAll(/`pnpm\s+([a-zA-Z0-9:_-]+)(?:\s+[^`]*)?`/g),
      ];
      for (const match of matches) {
        const cmd = match[1];
        if (!pkgScripts.has(cmd) && !PNPM_BUILTINS.has(cmd)) {
          invalidCommands.push({ doc, command: cmd });
        }
      }
    }

    if (invalidCommands.length > 0) {
      const summary = invalidCommands
        .map((c) => `  - [${c.doc}] Unknown pnpm command: \`pnpm ${c.command}\``)
        .join('\n');
      expect.fail(`Found ${invalidCommands.length} invalid pnpm commands in living docs:\n${summary}`);
    }
  });

  it('SPEC: README.md must document every environment variable from .env.example and every script from package.json', () => {
    const readmeContent = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const envExampleContent = fs.readFileSync(
      path.join(ROOT, '.env.example'),
      'utf8',
    );
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
    );

    const envVarRegex = /^[#\s]*([A-Z0-9_]+)=/gm;
    let envMatch: RegExpExecArray | null;
    const allEnvVars = new Set<string>();
    while ((envMatch = envVarRegex.exec(envExampleContent)) !== null) {
      allEnvVars.add(envMatch[1]);
    }

    const missingEnvVars: string[] = [];
    for (const envVar of allEnvVars) {
      if (!readmeContent.includes(envVar)) {
        missingEnvVars.push(envVar);
      }
    }

    const missingScripts: string[] = [];
    for (const scriptName of Object.keys(pkgJson.scripts || {})) {
      if (!readmeContent.includes(scriptName)) {
        missingScripts.push(scriptName);
      }
    }

    expect(
      missingEnvVars,
      `README.md missing environment variables: ${missingEnvVars.join(', ')}`,
    ).toEqual([]);
    expect(
      missingScripts,
      `README.md missing package.json scripts: ${missingScripts.join(', ')}`,
    ).toEqual([]);
  });

  it('SPEC: bare file names in the ARCHITECTURE.md folder table exist inside that row\'s folder', () => {
    // Rows look like: | `lib/hooks/` | Reusable hooks (`use-is-client.ts`). | ... |
    // A bare name (no slash) is resolved recursively under the row's folder, so invented helper files are caught.
    const content = fs.readFileSync(path.join(ROOT, 'ARCHITECTURE.md'), 'utf8');
    const missing: string[] = [];
    const findFile = (dir: string, name: string): boolean => {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name === name) return true;
        if (entry.isDirectory() && entry.name !== 'node_modules' && findFile(path.join(dir, entry.name), name)) return true;
      }
      return false;
    };
    for (const line of content.split('\n')) {
      const row = line.match(/^\|\s*`([a-z0-9_.()\[\]/-]+\/)`\s*\|(.*)$/i);
      if (!row) continue;
      const folder = row[1];
      for (const m of row[2].matchAll(/`([A-Za-z0-9_.-]+\.(?:tsx?|mjs|cjs|json))`/g)) {
        if (!findFile(path.join(ROOT, folder), m[1])) missing.push(`${folder} -> ${m[1]}`);
      }
    }
    expect(missing, `ARCHITECTURE.md folder table names files that do not exist:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('SPEC: ALLOWLIST entries must NOT exist on disk (honest allowlist)', () => {
    for (const [allowPath, reason] of ALLOWLIST) {
      const fullPath = path.join(ROOT, allowPath);
      expect(
        fs.existsSync(fullPath),
        `Allowlist entry "${allowPath}" (${reason}) now exists on disk. Please remove it from ALLOWLIST in tests/unit/clean003-docs-guards.test.ts`,
      ).toBe(false);
    }
  });
});

