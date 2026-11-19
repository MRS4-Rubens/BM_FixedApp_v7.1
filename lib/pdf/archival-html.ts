import { PRINT_STYLESHEET } from '@/lib/pdf/print-stylesheet.generated';
import { getPdfFontFaceCss } from '@/lib/pdf/pdf-fonts';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface ArchivalHtmlParts {
  readonly title: string; // plain text; escaped here
  readonly bodyHtml: string; // already-rendered, trusted markup from renderToStaticMarkup
  readonly extraCss?: string; // route-specific print rules (developer constants only)
  readonly bodyClass?: string;
}

// The templates import Lora / Libre Baskerville from Google Fonts for the on-screen view. The PDF page embeds its own
// font (pdf-fonts.ts), so the import is removed here: no network wait (~4 s) and no dependency on Google at render time.
const GOOGLE_FONTS_IMPORT = /@import\s+url\((['"]?)https:\/\/fonts\.googleapis\.com\/[^)]*\1\)\s*;?/g;

function stripGoogleFontImports(markup: string): string {
  return markup.replace(GOOGLE_FONTS_IMPORT, '');
}

export function buildArchivalHtmlDocument(parts: ArchivalHtmlParts): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(parts.title)}</title>
  <style>${getPdfFontFaceCss()}</style>
  <style>${PRINT_STYLESHEET}</style>
  <style>${parts.extraCss ?? ''}</style>
</head>
<body${parts.bodyClass ? ` class="${escapeHtml(parts.bodyClass)}"` : ''}>${stripGoogleFontImports(parts.bodyHtml)}</body>
</html>`;
}

