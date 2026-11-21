import { describe, expect, it } from 'vitest';
import { collectHtmlClasses, purgeCssForHtml, requiredClasses } from '@/lib/pdf/purge-css';
import { PRINT_STYLESHEET } from '@/lib/pdf/print-stylesheet.generated';
import { buildArchivalHtmlDocument } from '@/lib/pdf/archival-html';

describe('B9a PDF stylesheet trimming', () => {
  it('reads the classes a selector needs, unescaping Tailwind names and ignoring :not()/[attr] contents', () => {
    expect(requiredClasses('.lg\\:grid-cols-4')).toEqual(['lg:grid-cols-4']);
    expect(requiredClasses('.w-\\[12px\\]')).toEqual(['w-[12px]']);
    expect(requiredClasses('.\\32 xl\\:block')).toEqual(['2xl:block']);
    expect(requiredClasses('.group:hover .group-hover\\:text-red-500')).toEqual(['group', 'group-hover:text-red-500']);
    expect(requiredClasses('.space-y-2>:not(:last-child)')).toEqual(['space-y-2']);
    expect(requiredClasses('.x:not(.y)')).toEqual(['x']);
    expect(requiredClasses('[data-a=".b"] .c')).toEqual(['c']);
    expect(requiredClasses('html,body')).toEqual([]);
  });

  it('collects classes from class attributes, decoding HTML entities', () => {
    const c = collectHtmlClasses('<div class="a  b"><span class="[&amp;&gt;svg]:size-4"></span></div>');
    expect([...c].sort()).toEqual(['[&>svg]:size-4', 'a', 'b']);
  });

  it('keeps base rules and used classes, drops unused classes, recurses into @media/@layer, keeps other at-rules', () => {
    const css =
      '@layer theme{:root{--x:1}}@property --y{syntax:"*";inherits:false}' +
      '@layer utilities{.used{color:red}.unused{color:blue}@media print{.used{display:none}.gone{display:none}}' +
      '.a,.zzz{margin:0}.b .c{padding:0}}html{line-height:1.5}@keyframes spin{to{transform:rotate(1turn)}}';
    const out = purgeCssForHtml(css, '<div class="used a b"></div>');
    expect(out).toContain(':root{--x:1}');
    expect(out).toContain('@property --y');
    expect(out).toContain('.used{color:red}');
    expect(out).toContain('@media print{.used{display:none}}');
    expect(out).toContain('.a,.zzz{margin:0}');
    expect(out).toContain('html{line-height:1.5}');
    expect(out).toContain('@keyframes spin');
    expect(out).not.toContain('.unused');
    expect(out).not.toContain('.gone');
    expect(out).not.toContain('.b .c'); // needs .c too
  });

  it('keeps escaped Tailwind variant classes the page uses', () => {
    const css = '.md\\:flex{display:flex}.lg\\:hidden{display:none}';
    expect(purgeCssForHtml(css, '<div class="md:flex"></div>')).toBe('.md\\:flex{display:flex}');
  });

  it('the real print stylesheet shrinks to a fraction for an invoice-sized page', () => {
    const html = '<div class="p-4 text-sm font-bold flex items-center border border-slate-300 w-full"></div>';
    const trimmed = purgeCssForHtml(PRINT_STYLESHEET, html);
    expect(trimmed.length).toBeLessThan(PRINT_STYLESHEET.length * 0.3);
    expect(trimmed).toContain('.p-4');
    expect(trimmed).toContain('.font-bold');
  });

  it('the archival document embeds the trimmed stylesheet, not the full one', () => {
    const doc = buildArchivalHtmlDocument({ title: 'T', bodyHtml: '<p class="text-sm">x</p>' });
    const styles = [...doc.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    expect(styles[1]).toContain('.text-sm');
    expect(styles[1].length).toBeLessThan(PRINT_STYLESHEET.length * 0.3);
  });
});
