import { describe, expect, it } from 'vitest';
import { buildArchivalHtmlDocument, escapeHtml } from '@/lib/pdf/archival-html';

describe('archival-html document builder', () => {
  it('escapes html special characters in title and helper', () => {
    const maliciousTitle = 'Invoice <script>alert("xss")</script> & \'quote\'';
    const escaped = escapeHtml(maliciousTitle);

    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
    expect(escaped).toContain('&quot;xss&quot;');
    expect(escaped).toContain('&amp;');
    expect(escaped).toContain('&#39;quote&#39;');

    const doc = buildArchivalHtmlDocument({
      title: maliciousTitle,
      bodyHtml: '<div>Valid Body</div>',
    });
    expect(doc).toContain('<title>Invoice &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;quote&#39;</title>');
  });

  it('inserts bodyHtml verbatim without double escaping', () => {
    const rawBody = '<div class="invoice-container"><p>Total: ₹5,000</p></div>';
    const doc = buildArchivalHtmlDocument({
      title: 'Invoice 101',
      bodyHtml: rawBody,
    });
    expect(doc).toContain(rawBody);
  });

  it('embeds compiled print stylesheet and route-specific extraCss', () => {
    const customCss = '@page { size: A4; } .custom-rule { color: red; }';
    const doc = buildArchivalHtmlDocument({
      title: 'Invoice 102',
      bodyHtml: '<div>Test</div>',
      extraCss: customCss,
      bodyClass: 'my-body-class',
    });

    expect(doc).toContain('--primary');
    expect(doc).toContain(customCss);
    expect(doc).toContain('class="my-body-class"');
  });

  it('contains no .next paths anywhere in the generated html', () => {
    const doc = buildArchivalHtmlDocument({
      title: 'Invoice 103',
      bodyHtml: '<div>Clean</div>',
    });
    expect(doc).not.toContain('.next');
  });
});


describe('LAUNCH-L7 embedded PDF font', () => {
  it('embeds all four TeX Gyre Schola faces (unmodified files) as Century Schoolbook, plus a ₹ fallback', async () => {
    const { readFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const { getPdfFontFaceCss } = await import('@/lib/pdf/pdf-fonts');
    const css = getPdfFontFaceCss();
    expect(css.match(/font-family: 'Century Schoolbook'; src: url\(data:font\/otf;base64,/g)).toHaveLength(4);
    expect(css).toContain('font-weight: 700; font-style: italic;');
    expect(css).toContain('unicode-range: U+20B9;');
    const doc = buildArchivalHtmlDocument({ title: 'T', bodyHtml: '<p>x</p>' });
    expect(doc).toContain("font-family: 'Century Schoolbook'; src: url(data:font/otf;base64,");
    // The embedded bytes are the original CTAN files (licence: unmodified), checked against the README checksums.
    const readme = readFileSync('assets/fonts/tex-gyre-schola/README-TEX-GYRE-SCHOLA.txt', 'utf8');
    for (const name of ['regular', 'bold', 'italic', 'bolditalic']) {
      const file = readFileSync(`assets/fonts/tex-gyre-schola/texgyreschola-${name}.otf`);
      expect(file.subarray(0, 4).toString('latin1')).toBe('OTTO');
      expect(readme).toContain(createHash('sha256').update(file).digest('hex'));
    }
  });

  it('the templates ask for Century Schoolbook FIRST, so the embedded face is the one used', async () => {
    const { readFileSync } = await import('node:fs');
    for (const n of [1, 2, 3, 4]) {
      expect(readFileSync(`components/app/invoices/templates/template-${n}.tsx`, 'utf8')).toContain("font-family: 'Century Schoolbook', ");
    }
  });

  it('drops the Google Fonts import from the PDF page only (no network wait), keeping everything else', () => {
    const body = `<style>@import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400&display=swap'); .x{color:red}</style><p>Hi</p>`;
    const doc = buildArchivalHtmlDocument({ title: 'T', bodyHtml: body });
    expect(doc).not.toContain('fonts.googleapis.com');
    expect(doc).toContain('.x{color:red}');
    expect(doc).toContain('<p>Hi</p>');
  });
});
