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

export type InkVerdict = 'black' | 'blue' | 'other' | 'none';

/**
 * Classifies ink colour into 'black', 'blue', 'other', or 'none'.
 * Analyzes pixels darker than 70% of paper luminance, after white-balancing against the paper colour.
 */
export function classifyInkColour(
  img: SignatureImageData,
  paperLum: number
): { verdict: InkVerdict; inkPixels: number; blueShare: number; otherShare: number } {
  const threshold = paperLum * 0.7;
  const totalPixels = img.width * img.height;
  const data = img.data;

  // White balance: phone photos under warm/yellow room light tint everything, which would make the
  // anti-aliased edges of BLACK ink look brown ("other"). Measure the paper's own colour and divide it out
  // before judging hue, so the verdict is about the pen, not the light.
  let paperR = 0;
  let paperG = 0;
  let paperB = 0;
  let paperCount = 0;
  const paperFloor = paperLum * 0.95;
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    if (luminance(data[idx], data[idx + 1], data[idx + 2]) >= paperFloor) {
      paperR += data[idx];
      paperG += data[idx + 1];
      paperB += data[idx + 2];
      paperCount++;
    }
  }
  const scaleR = paperCount > 0 ? 255 / Math.max(1, paperR / paperCount) : 1;
  const scaleG = paperCount > 0 ? 255 / Math.max(1, paperG / paperCount) : 1;
  const scaleB = paperCount > 0 ? 255 / Math.max(1, paperB / paperCount) : 1;

  let inkPixels = 0;
  let blueCount = 0;
  let otherCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const lum = luminance(data[idx], data[idx + 1], data[idx + 2]);

    if (lum < threshold) {
      const r = Math.min(255, data[idx] * scaleR);
      const g = Math.min(255, data[idx + 1] * scaleG);
      const b = Math.min(255, data[idx + 2] * scaleB);
      inkPixels++;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      const sat = max === 0 ? 0 : delta / max;

      let isNeutral = false;
      if (max < 70 || sat < 0.25) {
        isNeutral = true;
      }

      if (!isNeutral) {
        let hue = 0;
        if (delta > 0) {
          if (max === r) {
            hue = ((g - b) / delta) % 6;
          } else if (max === g) {
            hue = (b - r) / delta + 2;
          } else {
            hue = (r - g) / delta + 4;
          }
          hue = hue * 60;
          if (hue < 0) hue += 360;
        }

        if (hue >= 190 && hue <= 260) {
          blueCount++;
        } else {
          otherCount++;
        }
      }
    }
  }

  if (inkPixels === 0) {
    return { verdict: 'none', inkPixels: 0, blueShare: 0, otherShare: 0 };
  }

  const otherShare = otherCount / inkPixels;
  const blueShare = blueCount / inkPixels;

  if (otherShare > 0.15) {
    return { verdict: 'other', inkPixels, blueShare, otherShare };
  }
  if (blueShare >= 0.3) {
    return { verdict: 'blue', inkPixels, blueShare, otherShare };
  }
  return { verdict: 'black', inkPixels, blueShare, otherShare };
}

export interface InkBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  inkPixels: number;
}

/**
 * Finds bounding box of ink pixels (alpha >= 128) using a noise floor.
 */
export function findInkBounds(cleaned: SignatureImageData): InkBounds | null {
  const { width, height, data } = cleaned;
  if (width === 0 || height === 0) return null;

  const rowCounts = new Uint32Array(height);
  const colCounts = new Uint32Array(width);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      if (data[(rowOffset + x) * 4 + 3] >= 128) {
        rowCounts[y]++;
        colCounts[x]++;
      }
    }
  }

  const rowNoise = Math.max(1, Math.round(width * 0.002));
  const colNoise = Math.max(1, Math.round(height * 0.002));

  let minY = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    if (rowCounts[y] > rowNoise) {
      if (minY === -1) minY = y;
      maxY = y;
    }
  }

  let minX = -1;
  let maxX = -1;
  for (let x = 0; x < width; x++) {
    if (colCounts[x] > colNoise) {
      if (minX === -1) minX = x;
      maxX = x;
    }
  }

  if (minY === -1 || minX === -1) {
    return null;
  }

  let inkPixels = 0;
  for (let y = minY; y <= maxY; y++) {
    const rowOffset = y * width;
    for (let x = minX; x <= maxX; x++) {
      if (data[(rowOffset + x) * 4 + 3] >= 128) {
        inkPixels++;
      }
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    inkPixels,
  };
}

export type SignatureRejection = 'empty' | 'too_busy' | 'portrait' | 'wrong_colour';

/**
 * Validates dimensions, density, and orientation of the signature.
 */
export function assessSignature(
  bounds: InkBounds | null,
  imgW: number,
  imgH: number
): { ok: true } | { ok: false; reason: SignatureRejection } {
  if (!bounds || bounds.inkPixels < 150 || bounds.width < imgW * 0.05) {
    return { ok: false, reason: 'empty' };
  }

  if (bounds.height > bounds.width * 1.1) {
    return { ok: false, reason: 'portrait' };
  }

  const density = bounds.inkPixels / (bounds.width * bounds.height);
  if (density > 0.45) {
    return { ok: false, reason: 'too_busy' };
  }

  if (bounds.width >= imgW * 0.97 && bounds.height >= imgH * 0.97 && density > 0.2) {
    return { ok: false, reason: 'too_busy' };
  }

  return { ok: true };
}

/**
 * Fits a 3:1 bounding box around the signature by padding and growing the smaller side.
 */
export function fitRectForSignature(bounds: InkBounds): { sx: number; sy: number; sw: number; sh: number } {
  const padX = bounds.width * 0.06;
  const padY = bounds.height * 0.15;

  let w = bounds.width + 2 * padX;
  let h = bounds.height + 2 * padY;

  if (w / h > 3) {
    h = w / 3;
  } else {
    w = h * 3;
  }

  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const sx = cx - w / 2;
  const sy = cy - h / 2;

  return {
    sx,
    sy,
    sw: w,
    sh: h,
  };
}


