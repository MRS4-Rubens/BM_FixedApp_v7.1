import { PRINT_STYLESHEET } from '@/lib/pdf/print-stylesheet.generated';

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

export function buildArchivalHtmlDocument(parts: ArchivalHtmlParts): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(parts.title)}</title>
  <style>${PRINT_STYLESHEET}</style>
  <style>${parts.extraCss ?? ''}</style>
</head>
<body${parts.bodyClass ? ` class="${escapeHtml(parts.bodyClass)}"` : ''}>${parts.bodyHtml}</body>
</html>`;
}

