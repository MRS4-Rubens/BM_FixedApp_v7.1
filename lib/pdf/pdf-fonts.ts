import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logWarn } from '@/lib/actions/_shared/logger';

/**
 * Fonts embedded into the archival (PDF) HTML only (LAUNCH-L7).
 *
 * The invoice templates ask for `'Century Schoolbook', 'Century', 'Lora', 'TeX Gyre Schola', …, serif` and load Lora /
 * Libre Baskerville from Google Fonts. A cloud renderer (Cloudflare's Linux Chrome) has no Century Schoolbook, so the
 * PDF depended on a Google download (slow: ~4 s of the ~5 s render) or fell back to a generic serif.
 * We embed TeX Gyre Schola (a free Century Schoolbook clone, unmodified, GUST licence; see
 * assets/fonts/tex-gyre-schola/README-TEX-GYRE-SCHOLA.txt) under the FIRST name the templates ask for, so every PDF
 * uses the designer's first-choice face on any renderer, with no network fetch (archival-html.ts drops the Google
 * import from the PDF page only). The templates and the app's screens are not changed.
 *
 * TeX Gyre Schola has no ₹ glyph, so U+20B9 is mapped to fonts the renderer has (DejaVu is in Cloudflare's font list).
 *
 * B9a: the embedded files are WOFF2 subsets with only the characters invoices use (Latin, digits, punctuation; built by
 * scripts/fonts/subset-pdf-fonts.py): ~93 KB for all four faces instead of ~570 KB of full OTFs. Characters outside
 * the subset fall back to the renderer's fonts, exactly as characters Schola never had already did.
 */
const FONT_DIR = join(process.cwd(), 'assets', 'fonts', 'tex-gyre-schola', 'pdf');
const FAMILY = 'Century Schoolbook';

const FACES = [
  { file: 'bizfolio-schola-pdf-regular.woff2', weight: 400, style: 'normal' },
  { file: 'bizfolio-schola-pdf-bold.woff2', weight: 700, style: 'normal' },
  { file: 'bizfolio-schola-pdf-italic.woff2', weight: 400, style: 'italic' },
  { file: 'bizfolio-schola-pdf-bolditalic.woff2', weight: 700, style: 'italic' },
] as const;

const RUPEE_FALLBACK = `@font-face { font-family: '${FAMILY}'; src: local('DejaVu Serif'), local('DejaVu Sans'), local('Georgia'), local('Noto Serif'); unicode-range: U+20B9; }`;

let cached: string | undefined;

/** CSS `@font-face` rules for the PDF page. Never throws: if the files are missing the PDF still renders (fallback font). */
export function getPdfFontFaceCss(): string {
  if (cached !== undefined) return cached;
  try {
    const faces = FACES.map(({ file, weight, style }) => {
      const base64 = readFileSync(join(FONT_DIR, file)).toString('base64');
      return `@font-face { font-family: '${FAMILY}'; src: url(data:font/woff2;base64,${base64}) format('woff2'); font-weight: ${weight}; font-style: ${style}; font-display: block; }`;
    });
    cached = [...faces, RUPEE_FALLBACK].join('\n');
  } catch (error: unknown) {
    logWarn('pdf-fonts', 'embedded PDF fonts unavailable; PDFs use the fallback serif', {
      reason: error instanceof Error ? error.name : 'unknown',
    });
    cached = '';
  }
  return cached;
}
