// Business-name fitting for the Pro invoice headers (Templates 2, 3, 4).
//
// Decides line breaks and font size from the space ACTUALLY available, instead of counting characters:
//   available = header width - 1cm on each side - the logo's real width - the 12px logo gap.
// The name keeps one line at the largest size that fits; only when it cannot fit does it split into lines of
// balanced length (never a lone last word when a better split exists).
//
// The PDF is rendered server-side, where nothing can be measured, so text width is ESTIMATED from a table of
// per-character advance widths: the wider of Century Schoolbook (Windows/Office browsers) and Lora (the PDF service and
// other machines), both at the templates' heavy weight, measured once in Chrome (2026-11-15). Rendered text is never
// wider than the estimate in those fonts; with any other fallback font the lines can still wrap on their own (CSS),
// so the name is never clipped and never overflows.
//
// Pure module: no React, no DOM.

/** Advance width in em (font-size = 1) of each uppercase glyph; names are shown uppercase. */
const CHAR_EM: Readonly<Record<string, number>> = {
  '0': 0.636, '1': 0.574, '2': 0.574, '3': 0.574, '4': 0.574, '5': 0.574, '6': 0.575, '7': 0.574, '8': 0.574, '9': 0.576,
  A: 0.759, B: 0.778, C: 0.778, D: 0.833, E: 0.759, F: 0.722, G: 0.833, H: 0.87, I: 0.444, J: 0.648, K: 0.815,
  L: 0.722, M: 0.981, N: 0.833, O: 0.833, P: 0.759, Q: 0.833, R: 0.815, S: 0.667, T: 0.722, U: 0.833, V: 0.759,
  W: 1.016, X: 0.722, Y: 0.722, Z: 0.667,
  ' ': 0.287, '&': 0.852, '.': 0.278, ',': 0.278, '-': 0.471, "'": 0.241, '(': 0.389, ')': 0.389, '/': 0.699,
  '+': 0.606, '@': 0.793, ':': 0.278, ';': 0.278, '"': 0.333, '!': 0.296, '?': 0.503, '#': 0.871, '%': 0.904,
  _: 0.832, '*': 0.533,
};
/** Unknown characters (other scripts, accents) are assumed as wide as the widest capital: errs on the safe side. */
const UNKNOWN_CHAR_EM = 1.016;
/** Letter spacing of the name (tracking-[0.08em]) added after every character except the last (cancelled by -mr). */
const LETTER_SPACING_EM = 0.08;
/** Headroom for sub-pixel rounding and kerning differences. */
const SAFETY = 1.02;

/** Header geometry, in CSS px (96 per inch). */
export const ONE_CM_PX = 96 / 2.54; // 37.8
const LOGO_HEIGHT_PX = 52;
export const LOGO_MAX_WIDTH_PX = 156;
const LOGO_GAP_PX = 12;
/** Header content width on A4 (210mm minus the templates' 0.6cm print margins); also the in-app A4 paper. */
export const A4_HEADER_WIDTH_PX = 748;
/** Header content width of the in-app A5 preview (700px paper minus padding). */
export const A5_HEADER_WIDTH_PX = 660;

export function estimateLineWidthPx(text: string, fontPx: number): number {
  const chars = [...text.toUpperCase()];
  if (chars.length === 0) return 0;
  const em = chars.reduce((sum, c) => sum + (CHAR_EM[c] ?? UNKNOWN_CHAR_EM), 0) + LETTER_SPACING_EM * (chars.length - 1);
  return em * fontPx * SAFETY;
}

/** Room for the name: header width minus 1cm each side, minus the logo and its gap (if there is a logo). */
export function availableNameWidthPx(headerWidthPx: number, logoWidthPx: number | null): number {
  const logo = logoWidthPx === null ? 0 : logoWidthPx + LOGO_GAP_PX;
  return Math.max(0, headerWidthPx - 2 * ONE_CM_PX - logo);
}

/** Split words into `count` lines so the longest line (in estimated px) is as short as possible. */
function balanceWords(words: readonly string[], count: number, fontPx: number): string[] {
  const n = words.length;
  if (count <= 1 || n <= 1) return [words.join(' ')];
  const width = (from: number, to: number) => estimateLineWidthPx(words.slice(from, to).join(' '), fontPx);
  const best: number[][] = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(n));
  for (let i = 0; i < n; i++) best[1]![i] = width(i, n);
  for (let k = 2; k <= count; k++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const worst = Math.max(width(i, j), best[k - 1]![j]!);
        if (worst < best[k]![i]!) {
          best[k]![i] = worst;
          cut[k]![i] = j;
        }
      }
    }
  }
  const lines: string[] = [];
  let i = 0;
  for (let k = Math.min(count, n); k > 1 && i < n; k--) {
    const j = cut[k]![i]!;
    lines.push(words.slice(i, j).join(' '));
    i = j;
  }
  if (i < n) lines.push(words.slice(i).join(' '));
  return lines;
}

/**
 * Tried in order; the first that fits wins. One line keeps the full size (a barely visible 26 -> 24 step first);
 * wrapping uses balanced lines; smaller sizes only for very long names. Two 24px lines are about the logo's height.
 */
const LADDER: ReadonlyArray<{ lines: number; px: number }> = [
  // One-line names may be larger: beside the 52px logo a one-line name up to ~46px adds no height, so these only
  // fill the empty space above and below the name. 26/24 stay below, so no name wraps because of these steps.
  { lines: 1, px: 32 },
  { lines: 1, px: 30 },
  { lines: 1, px: 28 },
  { lines: 1, px: 26 },
  { lines: 1, px: 24 },
  { lines: 2, px: 24 },
  { lines: 2, px: 21 },
  { lines: 3, px: 18 },
  { lines: 4, px: 16 },
  { lines: 4, px: 14 },
  { lines: 5, px: 13 },
];

/** Tailwind needs literal class names (also picked up by the print stylesheet). */
const SIZE_CLASS: Readonly<Record<number, string>> = {
  32: 'text-[32px]',
  30: 'text-[30px]',
  28: 'text-[28px]',
  26: 'text-[26px]',
  24: 'text-[24px]',
  21: 'text-[21px]',
  18: 'text-[18px]',
  16: 'text-[16px]',
  14: 'text-[14px]',
  13: 'text-[13px]',
};

export interface BrandNameLayout {
  readonly lines: string[];
  readonly fontPx: number;
  readonly sizeClass: string;
}

/** Largest one-line size: 32px beside a logo; 28px without one (nothing taller beside it, so the header would grow). */
export const MAX_SINGLE_LINE_PX_WITH_LOGO = 32;
export const MAX_SINGLE_LINE_PX_WITHOUT_LOGO = 28;

export function fitBrandName(
  name: string,
  availableWidthPx: number,
  options: { readonly maxSingleLinePx?: number } = {},
): BrandNameLayout {
  const maxSingle = options.maxSingleLinePx ?? MAX_SINGLE_LINE_PX_WITH_LOGO;
  const clean = name.trim().replace(/\s+/g, ' ');
  const words = clean.split(' ');
  for (const step of LADDER) {
    if (step.lines === 1 && step.px > maxSingle) continue;
    if (step.lines > Math.max(1, words.length)) continue;
    const lines = step.lines === 1 ? [clean] : balanceWords(words, step.lines, step.px);
    if (lines.every((line) => estimateLineWidthPx(line, step.px) <= availableWidthPx)) {
      return { lines, fontPx: step.px, sizeClass: SIZE_CLASS[step.px]! };
    }
  }
  // Nothing fits (e.g. one enormous word): smallest step, balanced; CSS may still wrap inside a line, never clip.
  const last = LADDER[LADDER.length - 1]!;
  const lines = balanceWords(words, Math.min(last.lines, words.length), last.px);
  return { lines, fontPx: last.px, sizeClass: SIZE_CLASS[last.px]! };
}

/**
 * Rendered width of the logo box: 52px tall, at most 156px wide, aspect from the image file itself.
 * Reads the pixel size from the image header of a base64 data URI (PNG, JPEG, WebP, GIF).
 * Unknown/unreadable => the widest allowed logo (safe: never under-estimates the logo).
 */
export function logoRenderWidthPx(logoSrc: string | null | undefined): number | null {
  if (!logoSrc) return null;
  const size = imageSizeFromDataUri(logoSrc);
  if (!size || size.width <= 0 || size.height <= 0) return LOGO_MAX_WIDTH_PX;
  return Math.min(LOGO_MAX_WIDTH_PX, (LOGO_HEIGHT_PX * size.width) / size.height);
}

function decodeHead(dataUri: string, bytes: number): Uint8Array | null {
  const comma = dataUri.indexOf(',');
  if (!dataUri.startsWith('data:') || comma === -1 || !dataUri.slice(0, comma).includes(';base64')) return null;
  // Enough base64 for the first `bytes` bytes (JPEG headers can be further in, so callers ask for a generous slice).
  const b64 = dataUri.slice(comma + 1, comma + 1 + Math.ceil(bytes / 3) * 4).replace(/[^A-Za-z0-9+/]/g, '');
  try {
    const bin = atob(b64.slice(0, b64.length - (b64.length % 4)));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function imageSizeFromDataUri(dataUri: string): { width: number; height: number } | null {
  const b = decodeHead(dataUri, 65536);
  if (!b || b.length < 30) return null;
  const u16be = (o: number) => (b[o]! << 8) | b[o + 1]!;
  const u16le = (o: number) => b[o]! | (b[o + 1]! << 8);
  const u24le = (o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
  const u32be = (o: number) => ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;
  // PNG: signature + IHDR width/height (big-endian) at bytes 16..23
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: u32be(16), height: u32be(20) };
  }
  // GIF: logical screen size (little-endian) at bytes 6..9
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: u16le(6), height: u16le(8) };
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X chunk
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (chunk === 'VP8X') return { width: u24le(24) + 1, height: u24le(27) + 1 };
    if (chunk === 'VP8L') {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    return null;
  }
  // JPEG: walk segments to the first SOFn marker
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null;
      const marker = b[o + 1]!;
      const len = u16be(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: u16be(o + 7), height: u16be(o + 5) };
      }
      o += 2 + len;
    }
  }
  return null;
}
