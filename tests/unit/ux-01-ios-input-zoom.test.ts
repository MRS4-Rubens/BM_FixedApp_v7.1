import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * UX-01: iOS Safari zooms in when an input with text under 16px is focused. app/desktop-workspace.css raises in-app
 * inputs to 16px on iOS only. These guards keep the rule effective: it must stay outside any @layer (inside one,
 * Tailwind's text-xs / text-sm utilities would win and the fix would silently do nothing).
 */
const css = readFileSync(join(process.cwd(), 'app', 'desktop-workspace.css'), 'utf8');
const ruleStart = css.indexOf('@supports (-webkit-touch-callout: none)');

describe('UX-01: iOS-only 16px inputs inside the app', () => {
  it('the iOS rule exists and sets 16px on text inputs, selects and textareas', () => {
    expect(ruleStart).toBeGreaterThan(-1);
    const rule = css.slice(ruleStart);
    expect(rule).toMatch(/font-size:\s*16px/);
    expect(rule).toContain("input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='file'])");
    expect(rule).toMatch(/select,\s*textarea/);
  });

  it('covers the page canvas, dialogs (portals) and the top-bar search', () => {
    const rule = css.slice(ruleStart);
    for (const scope of ['[data-desktop-canvas]', '[data-viewport-dialog]', "[role='dialog']", "[role='alertdialog']", '[data-app-topbar]']) {
      expect(rule, scope).toContain(scope);
    }
    const topbar = readFileSync(join(process.cwd(), 'components', 'app', 'app-topbar.tsx'), 'utf8');
    expect(topbar).toMatch(/<header data-app-topbar/);
  });

  it('is NOT inside an @layer block (it has to beat the Tailwind utilities)', () => {
    let depth = 0;
    const openers: string[] = [];
    for (let i = 0; i < ruleStart; i += 1) {
      if (css[i] === '{') {
        const head = css.slice(css.lastIndexOf('}', i) + 1, i).trim();
        openers.push(head);
        depth += 1;
      } else if (css[i] === '}') {
        openers.pop();
        depth -= 1;
      }
    }
    expect(depth).toBe(0);
    expect(openers.some((head) => head.startsWith('@layer'))).toBe(false);
  });

  it('never disables pinch-zoom (no maximum-scale / user-scalable in the viewport)', () => {
    const layout = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf8');
    expect(layout).not.toMatch(/maximum-?[sS]cale|userScalable|user-scalable/);
  });
});
