import { createRequire } from 'node:module';
import postcss, { type Plugin } from 'postcss';
import { describe, expect, it } from 'vitest';

const canvas = createRequire(import.meta.url)('../../config/desktop-canvas-postcss.cjs') as () => Plugin;

describe('scoped desktop presentation', () => {
  it('preserves original rules and replays desktop utilities only below the canvas boundary', async () => {
    const source = '@layer utilities { @media (width >= 64rem) { .lg\\:grid-cols-4 { grid-template-columns: repeat(4,1fr) } } }';
    const result = await postcss([canvas()]).process(source, { from: undefined });
    expect(result.css).toContain('.lg\\:grid-cols-4');
    expect(result.css).toContain('screen and (width < 80rem)');
    expect(result.css).toContain(':where([data-desktop-canvas]) .lg\\:grid-cols-4');
    expect(result.css.match(/grid-template-columns/g)).toHaveLength(2);
  });

  it('does not replay wide-desktop, print, or base utilities', async () => {
    const source = '@media (width >= 96rem) { .xl\\:block {display:block} } @media print { .lg\\:block {display:block} } .block {display:block}';
    const result = await postcss([canvas()]).process(source, { from: undefined });
    expect(result.css).not.toContain('[data-desktop-canvas]');
  });

  it('also replays the minified production form of the breakpoint query', async () => {
    // `next build` minifies Tailwind's output: "(width >= 64rem)" becomes "(min-width:64rem)".
    const source = '@layer utilities { @media (min-width:64rem) { .lg\\:grid-cols-4 { grid-template-columns: repeat(4,1fr) } } }';
    const result = await postcss([canvas()]).process(source, { from: undefined });
    expect(result.css).toContain(':where([data-desktop-canvas]) .lg\\:grid-cols-4');
    const wide = await postcss([canvas()]).process('@media (min-width:96rem) { .xl\\:block {display:block} }', { from: undefined });
    expect(wide.css).not.toContain('[data-desktop-canvas]');
  });
});
