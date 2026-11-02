import { describe, expect, it } from 'vitest';
import {
  compilePrintStylesheet,
  renderGeneratedModule,
  readCommitted,
} from '@/scripts/print-css/compile';
import { PRINT_STYLESHEET } from '@/lib/pdf/print-stylesheet.generated';

describe('print-stylesheet.generated.ts freshness and content guards', () => {
  it(
    'is up to date with app/globals.css and tailwind config (stale: run pnpm print-css:build)',
    async () => {
      const rootDir = process.cwd();
      const css = await compilePrintStylesheet(rootDir);
      const expectedModule = renderGeneratedModule(css);
      const committedModule = await readCommitted(rootDir);

      expect(committedModule).toBe(expectedModule);
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

