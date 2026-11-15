// Business-name fit (Templates 2-4): width-based line breaks and sizes. Real-render quality (1cm margins, 12px gap,
// centring, no unplanned wraps) was measured on 675 rendered layouts (3 templates x 5 logo shapes x 9 names x A4/A5/wide,
// Century Schoolbook and Lora); these tests lock the rules.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deflateSync } from 'node:zlib';
import {
  A4_HEADER_WIDTH_PX,
  A5_HEADER_WIDTH_PX,
  LOGO_MAX_WIDTH_PX,
  ONE_CM_PX,
  availableNameWidthPx,
  estimateLineWidthPx,
  fitBrandName,
  imageSizeFromDataUri,
  logoRenderWidthPx,
} from '@/lib/invoices/brand-name-fit';
import { BrandLockup } from '@/components/app/invoices/templates/header-parts';

function pngDataUri(w: number, h: number): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]); // CRC not checked by the size reader
  };
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(h * (1 + w * 3)))),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const A4_SQUARE_LOGO = availableNameWidthPx(A4_HEADER_WIDTH_PX, 52);

describe('Brand name fit: geometry', () => {
  it('room = header width - 1cm each side - logo - 12px gap', () => {
    expect(ONE_CM_PX).toBeCloseTo(37.8, 1);
    expect(availableNameWidthPx(748, 52)).toBeCloseTo(748 - 2 * 37.8 - 64, 0);
    expect(availableNameWidthPx(748, null)).toBeCloseTo(748 - 2 * 37.8, 0); // no logo, no gap
    expect(availableNameWidthPx(10, 156)).toBe(0);
  });

  it('reads the logo size from PNG, GIF, JPEG and WebP data, and derives the 52px-tall box width', () => {
    expect(imageSizeFromDataUri(pngDataUri(240, 80))).toEqual({ width: 240, height: 80 });
    expect(logoRenderWidthPx(pngDataUri(120, 120))).toBeCloseTo(52, 5);
    expect(logoRenderWidthPx(pngDataUri(60, 120))).toBeCloseTo(26, 5);
    expect(logoRenderWidthPx(pngDataUri(400, 80))).toBe(LOGO_MAX_WIDTH_PX); // capped at 3:1
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 100, 0, 50, 0, ...new Array(30).fill(0)]);
    expect(imageSizeFromDataUri(`data:image/gif;base64,${gif.toString('base64')}`)).toEqual({ width: 100, height: 50 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 90, 1, 44, 3, ...new Array(30).fill(0)]);
    expect(imageSizeFromDataUri(`data:image/jpeg;base64,${jpeg.toString('base64')}`)).toEqual({ width: 300, height: 90 });
    const webp = Buffer.alloc(40);
    webp.write('RIFF', 0);
    webp.write('WEBPVP8X', 8);
    webp.writeUIntLE(199, 24, 3);
    webp.writeUIntLE(99, 27, 3);
    expect(imageSizeFromDataUri(`data:image/webp;base64,${webp.toString('base64')}`)).toEqual({ width: 200, height: 100 });
  });

  it('an unreadable logo is treated as the widest allowed logo (never under-estimated); no logo => null', () => {
    expect(logoRenderWidthPx('data:image/png;base64,AAAA')).toBe(LOGO_MAX_WIDTH_PX);
    expect(logoRenderWidthPx('https://example.com/logo.png')).toBe(LOGO_MAX_WIDTH_PX);
    expect(logoRenderWidthPx(null)).toBeNull();
  });
});

describe('Brand name fit: layout', () => {
  it('short and medium names stay on one line at full 26px', () => {
    expect(fitBrandName('BRAJESH KUMAR', A4_SQUARE_LOGO)).toMatchObject({ lines: ['BRAJESH KUMAR'], fontPx: 26 });
    expect(fitBrandName('BRAJESH KUMAR CLOTHING', A4_SQUARE_LOGO)).toMatchObject({ lines: ['BRAJESH KUMAR CLOTHING'], fontPx: 26 });
  });

  it('a name that does not fit one line wraps into BALANCED lines (no lone last word)', () => {
    const r = fitBrandName('BRAJESH KUMAR CLOTHING & MARKETING', A4_SQUARE_LOGO);
    expect(r.lines).toEqual(['BRAJESH KUMAR', 'CLOTHING & MARKETING']);
    expect(r.fontPx).toBe(24);
  });

  it('uses the space: the same name fits one line when there is more room (no logo)', () => {
    const r = fitBrandName('BRAJESH KUMAR CLOTHING & MARKETING', availableNameWidthPx(A4_HEADER_WIDTH_PX, null));
    expect(r.lines).toHaveLength(1);
  });

  it('every chosen line fits the room; very long names step down to more lines and smaller sizes', () => {
    const names = [
      'SHREE LAKSHMI VENKATESWARA TEXTILE TRADERS AND GENERAL MERCHANTS',
      'SHREE LAKSHMI VENKATESWARA TEXTILE TRADERS AND GENERAL MERCHANTS PRIVATE LIMITED WHOLESALE DISTRIBUTION DIVISION NO 2',
      'M/S. A-1 TRADERS (INDIA) PVT. LTD.',
      'WWW MMM WWW MMM WWW MMM WWW',
    ];
    for (const width of [A4_HEADER_WIDTH_PX, A5_HEADER_WIDTH_PX]) {
      for (const logo of [null, 26, 52, 156]) {
        const room = availableNameWidthPx(width, logo);
        for (const name of names) {
          const r = fitBrandName(name, room);
          for (const line of r.lines) expect(estimateLineWidthPx(line, r.fontPx)).toBeLessThanOrEqual(room);
          expect(r.lines.join(' ')).toBe(name); // nothing dropped or reordered
          expect(r.lines.every((l) => l.length > 0)).toBe(true);
        }
      }
    }
  });

  it('a single enormous word falls back to the smallest size and is never dropped (CSS may still wrap it)', () => {
    const r = fitBrandName('X'.repeat(80), 400);
    expect(r).toMatchObject({ lines: ['X'.repeat(80)], fontPx: 13 });
  });
});

describe('Brand name fit: rendering', () => {
  it('keeps 1cm side padding and renders one layout when A4 and A5 agree', () => {
    const html = renderToStaticMarkup(createElement(BrandLockup, { logoSrc: pngDataUri(120, 120), name: 'BRAJESH KUMAR', nameClassName: 'text-black' }));
    expect(html).toContain('@container');
    expect(html).toMatch(/data-hdr="lockup"[^>]*px-\[1cm\]/);
    expect(html.match(/data-hdr="name"/g)).toHaveLength(1);
  });

  it('renders an A4 and an A5 layout, switched by a container query, when they differ', () => {
    const html = renderToStaticMarkup(
      createElement(BrandLockup, { logoSrc: pngDataUri(240, 80), name: 'BRAJESH KUMAR CLOTHING', nameClassName: 'text-black' }),
    );
    expect(html.match(/data-hdr="name"/g)).toHaveLength(2);
    expect(html).toContain('@max-[747px]:hidden');
    expect(html).toContain('hidden @max-[747px]:block');
  });
});
