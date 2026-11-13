/**
 * Pure processing helpers for authorised signature images.
 * Operates on ImageData-compatible objects ({ data, width, height }).
 * Contains zero DOM references, zero browser globals, and no server imports.
 */

export interface SignatureImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export const SIGNATURE_OUTPUT_WIDTH = 900;
export const SIGNATURE_OUTPUT_HEIGHT = 300; // 3:1 aspect ratio, within 300–1500 px limits

export const INK_COLOURS = {
  black: [17, 24, 39], // slate-900
  blue: [30, 58, 138],  // blue-900
} as const;

export type InkColour = keyof typeof INK_COLOURS;

/**
 * Standard Rec. 601 perceived luminance calculation.
 */
export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Estimates paper/background luminance using the 90th percentile of a 256-bucket histogram.
 */
export function estimatePaperLuminance(img: SignatureImageData): number {
  const totalPixels = img.width * img.height;
  if (totalPixels === 0) return 255;

  const histogram = new Uint32Array(256);
  const data = img.data;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const lum = luminance(data[idx], data[idx + 1], data[idx + 2]);
    const bucket = Math.max(0, Math.min(255, Math.round(lum)));
    histogram[bucket]++;
  }

  const targetCount = totalPixels * 0.9;
  let cumulative = 0;
  for (let b = 0; b < 256; b++) {
    cumulative += histogram[b];
    if (cumulative >= targetCount) {
      return b;
    }
  }

  return 255;
}

/**
 * Detects whether ink is predominantly blue or black among ink-ish pixels (lum < paperLum * 0.7).
 * If mean B exceeds mean R and mean G by >= 20, returns 'blue', else 'black'.
 */
export function detectInkColour(img: SignatureImageData, paperLum: number): InkColour {
  const threshold = paperLum * 0.7;
  const totalPixels = img.width * img.height;
  const data = img.data;

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const lum = luminance(r, g, b);

    if (lum < threshold) {
      sumR += r;
      sumG += g;
      sumB += b;
      count++;
    }
  }

  if (count === 0) {
    return 'black';
  }

  const meanR = sumR / count;
  const meanG = sumG / count;
  const meanB = sumB / count;

  if (meanB - meanR >= 20 && meanB - meanG >= 20) {
    return 'blue';
  }

  return 'black';
}

/**
 * Cleans the background, extracts ink alpha, and recolours ink to the target ink colour.
 * hi = paper * (0.92 - strength * 0.002); lo = hi * 0.6;
 * Fully transparent pixels have RGB = 0.
 */
export function cleanSignature(
  img: SignatureImageData,
  { ink, strength }: { ink: InkColour; strength: number }
): { image: SignatureImageData; coverage: number } {
  const paper = estimatePaperLuminance(img);
  const hi = paper * (0.92 - strength * 0.002);
  const lo = hi * 0.6;
  const denom = hi - lo;

  const totalPixels = img.width * img.height;
  const outData = new Uint8ClampedArray(img.data.length);
  const color = INK_COLOURS[ink];
  const data = img.data;

  let countAlpha128 = 0;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const lum = luminance(r, g, b);

    let alpha: number;
    if (lum >= hi) {
      alpha = 0;
    } else if (lum <= lo) {
      alpha = 255;
    } else {
      alpha = denom > 0 ? Math.round((255 * (hi - lum)) / denom) : 255;
    }
    alpha = Math.max(0, Math.min(255, alpha));

    if (alpha === 0) {
      outData[idx] = 0;
      outData[idx + 1] = 0;
      outData[idx + 2] = 0;
      outData[idx + 3] = 0;
    } else {
      outData[idx] = color[0];
      outData[idx + 1] = color[1];
      outData[idx + 2] = color[2];
      outData[idx + 3] = alpha;
    }

    if (alpha >= 128) {
      countAlpha128++;
    }
  }

  const coverage = totalPixels > 0 ? countAlpha128 / totalPixels : 0;

  return {
    image: {
      data: outData,
      width: img.width,
      height: img.height,
    },
    coverage,
  };
}

/**
 * Validates that ink coverage falls within statutory readability limits:
 * - Empty: coverage < 0.3% (0.003)
 * - Too much: coverage > 35% (0.35)
 */
export function validateCoverage(
  coverage: number
): { ok: true } | { ok: false; reason: 'empty' | 'too_much' } {
  if (coverage < 0.003) {
    return { ok: false, reason: 'empty' };
  }
  if (coverage > 0.35) {
    return { ok: false, reason: 'too_much' };
  }
  return { ok: true };
}

