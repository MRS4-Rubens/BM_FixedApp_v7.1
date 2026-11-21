import { describe, expect, it } from 'vitest';
import {
  compilePrintStylesheet,
  renderGeneratedModule,
  readCommitted,
} from '@/scripts/print-css/compile';
import { PRINT_STYLESHEET } from '@/lib/pdf/print-stylesheet.generated';

function cssRules(css: string): Map<string, string> {
  const rules = new Map<string, string>();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    rules.set(selector, (rules.get(selector) ?? '') + match[2]);
  }
  return rules;
}

function describeStylesheetDrift(committed: string, fresh: string): string {
  if (committed === fresh) return 'identical';
  const committedRules = cssRules(committed);
  const freshRules = cssRules(fresh);
  const onlyCommitted = [...committedRules.keys()].filter((s) => !freshRules.has(s));
  const onlyFresh = [...freshRules.keys()].filter((s) => !committedRules.has(s));
  const changed = [...committedRules.keys()].filter((s) => freshRules.has(s) && freshRules.get(s) !== committedRules.get(s));
  let at = 0;
  while (at < committed.length && committed[at] === fresh[at]) at++;
  return [
    'Stale print stylesheet: run `pnpm print-css:build` and commit lib/pdf/print-stylesheet.generated.ts.',
    `lengths: committed ${committed.length}, fresh ${fresh.length}; first difference at char ${at}`,
    `committed: …${committed.slice(Math.max(0, at - 80), at + 160)}…`,
    `fresh:     …${fresh.slice(Math.max(0, at - 80), at + 160)}…`,
    `rules only in committed (${onlyCommitted.length}): ${onlyCommitted.slice(0, 40).join(' | ')}`,
    `rules only in fresh (${onlyFresh.length}): ${onlyFresh.slice(0, 40).join(' | ')}`,
    `rules with changed bodies (${changed.length}): ${changed.slice(0, 40).join(' | ')}`,
  ].join('\n');
}

describe('print-stylesheet.generated.ts freshness and content guards', () => {
  it(
    'is up to date with app/globals.css and tailwind config (stale: run pnpm print-css:build)',
    async () => {
      const rootDir = process.cwd();
      const css = await compilePrintStylesheet(rootDir);
      const expectedModule = renderGeneratedModule(css);
      const committedModule = await readCommitted(rootDir);

      // The modules are one huge line, so a plain toBe() failure is truncated and unreadable in CI.
      // Report which CSS rules differ instead.
      expect(committedModule === expectedModule, describeStylesheetDrift(committedModule, expectedModule)).toBe(true);
    },
    60_000,
  );

  it('has a realistic stylesheet size between 5 KB and 1.5 MB', () => {
    const bytes = Buffer.byteLength(PRINT_STYLESHEET, 'utf8');
    expect(bytes).toBeGreaterThan(5 * 1024);
    expect(bytes).toBeLessThan(1.5 * 1024 * 1024);
  });

  it('contains design tokens and essential print layout utilities', () => {
    expect(PRINT_STYLESHEET).toContain('--primary');
    expect(PRINT_STYLESHEET).toContain('font-bold');
    expect(PRINT_STYLESHEET).toContain('text-right');
    expect(PRINT_STYLESHEET).toContain('border');
    expect(PRINT_STYLESHEET).toContain('w-full');
    expect(PRINT_STYLESHEET).toContain('border-collapse');
  });

  it('contains no sourceMappingURL', () => {
    expect(PRINT_STYLESHEET).not.toContain('sourceMappingURL');
  });
});

