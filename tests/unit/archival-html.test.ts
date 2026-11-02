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

