import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { getRequestTimeMs } from '@/lib/time/request-time';
import { useIsClient } from '@/lib/hooks/use-is-client';

describe('FE-002: React render purity & hydration guards', () => {
  it('getRequestTimeMs returns the current time in milliseconds', () => {
    const before = Date.now();
    const result = getRequestTimeMs();
    const after = Date.now();

    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('exports useIsClient function', () => {
    expect(typeof useIsClient).toBe('function');
  });

  it('ensures no setMounted or setIsMounted exist in app or components', () => {
    const rootDir = process.cwd();
    const checkDir = (dirRel: string): string[] => {
      const dirPath = resolve(rootDir, dirRel);
      const violations: string[] = [];

      function walk(current: string) {
        if (!existsSync(current)) return;
        const stat = statSync(current);
        if (stat.isDirectory()) {
          for (const child of readdirSync(current)) {
            walk(join(current, child));
          }
        } else if (/\.(tsx?|jsx?)$/.test(current)) {
          const content = readFileSync(current, 'utf8');
          if (/\b(setMounted|setIsMounted)\b/.test(content)) {
            violations.push(relative(rootDir, current));
          }
        }
      }

      walk(dirPath);
      return violations;
    };

    const violations = [...checkDir('app'), ...checkDir('components')];
    expect(violations).toEqual([]);
  });

  it('ensures suppressHydrationWarning is removed from <body> in app/layout.tsx', () => {
    const layoutContent = readFileSync(resolve(process.cwd(), 'app/layout.tsx'), 'utf8');
    // <body must not have suppressHydrationWarning
    const bodyTagMatch = layoutContent.match(/<body[^>]*>/);
    expect(bodyTagMatch).not.toBeNull();
    expect(bodyTagMatch![0]).not.toContain('suppressHydrationWarning');

    // <html must retain suppressHydrationWarning
    const htmlTagMatch = layoutContent.match(/<html[^>]*>/);
    expect(htmlTagMatch).not.toBeNull();
    expect(htmlTagMatch![0]).toContain('suppressHydrationWarning');
  });

  it('ensures sidebar:collapsed cookie reading is tri-state in layouts', () => {
    const appLayout = readFileSync(resolve(process.cwd(), 'app/(app)/layout.tsx'), 'utf8');
    const adminLayout = readFileSync(resolve(process.cwd(), 'app/(admin)/layout.tsx'), 'utf8');

    for (const layout of [appLayout, adminLayout]) {
      expect(layout).toContain('collapsedPreference');
      expect(layout).not.toContain('defaultCollapsed');
    }
  });
});
