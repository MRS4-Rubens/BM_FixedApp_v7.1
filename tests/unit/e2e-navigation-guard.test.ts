import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * E2E navigation must go through e2e/support/navigation.ts (gotoApp / waitForAppUrl / reloadApp), which waits for the
 * document + Next.js client runtime instead of the browser "load" event (a single slow third-party request stalled
 * "load" for 20–30 s and made local runs flaky). Exempt on purpose: 05-a11y (axe needs fonts/styles fully applied),
 * 06-print-layout (needs the fully rendered page) and 07-mailbox (external verification link, normally skipped).
 */
const ROOT = process.cwd();
const EXEMPT_SPECS = new Set(['05-a11y.spec.ts', '06-print-layout.spec.ts', '07-mailbox-verification.spec.ts']);
const RAW_NAVIGATION = /\b(?:this\.)?(?:page|authPage)\.(?:goto|waitForURL|reload)\(/;

function filesIn(dir: string): string[] {
  return readdirSync(join(ROOT, dir))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(dir, name));
}

describe('E2E navigation waits (no raw "load" waits)', () => {
  const targets = [
    ...filesIn('e2e/pages'),
    ...filesIn('e2e/setup'),
    ...filesIn('e2e/specs').filter((f) => !EXEMPT_SPECS.has(f.split(/[\\/]/).pop() ?? '')),
  ];

  it('covers page objects, the global setup and the journey/security/boundary/mobile specs', () => {
    expect(targets.length).toBeGreaterThanOrEqual(10);
  });

  it('no page object, setup file or non-exempt spec calls page.goto / waitForURL / reload directly', () => {
    const offenders: string[] = [];
    for (const rel of targets) {
      readFileSync(join(ROOT, rel), 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (RAW_NAVIGATION.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('the helper waits for domcontentloaded + window.next + a BOUNDED "load" grace, never an unbounded load wait', () => {
    const helper = readFileSync(join(ROOT, 'e2e/support/navigation.ts'), 'utf8');
    expect(helper).toContain("waitUntil: 'domcontentloaded'");
    expect(helper).toContain("waitUntil: 'commit'");
    expect(helper).toContain('w.next');
    // The load wait must stay bounded by LOAD_GRACE_MS and must not fail the step when "load" stalls.
    expect(helper).toMatch(/waitForLoadState\('load',\s*\{\s*timeout:\s*Math\.min\(LOAD_GRACE_MS/);
    expect(helper).toMatch(/\.catch\(\(\) =>/);
    expect(helper).not.toMatch(/waitUntil:\s*'load'/);
  });
});
