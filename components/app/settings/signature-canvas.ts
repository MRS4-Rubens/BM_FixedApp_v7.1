'use client';

import {
  cleanSignature,
  classifyInkColour,
  estimatePaperLuminance,
  findInkBounds,
  assessSignature,
  fitRectForSignature,
  type SignatureRejection,
  SIGNATURE_OUTPUT_WIDTH,
  INK_COLOURS,
} from '@/lib/signature/process-signature';
import { SIGNATURE_MAX_BYTES } from '@/lib/security/signature-limits';

/** PURE: one ink colour everywhere and alpha rounded to 16 levels (0 stays 0, so the background stays transparent). */
export function quantiseInk(data: Uint8ClampedArray, ink: readonly [number, number, number]): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      continue;
    }
    data[i] = ink[0];
    data[i + 1] = ink[1];
    data[i + 2] = ink[2];
    data[i + 3] = Math.max(17, Math.round(a / 17) * 17);
  }
}

/** PURE: output widths to try, largest first (3:1, within the server's 300..1500 px rule). Exported for tests. */
export function signatureOutputWidths(): number[] {
  return [SIGNATURE_OUTPUT_WIDTH, 750, 600, 450, 300].filter((w, i, all) => all.indexOf(w) === i && w <= SIGNATURE_OUTPUT_WIDTH);
}

export type ProcessOutcome =
  | { ok: true; dataUrl: string; ink: 'black' | 'blue' }
  | { ok: false; reason: SignatureRejection | 'too_large' };

/**
 * Converts canvas to PNG data URL via canvas.toBlob.
 */
function canvasToPngDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(canvas.toDataURL('image/png'));
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          resolve(canvas.toDataURL('image/png'));
        }
      };
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}

/**
 * Processes an input signature image: classifies ink, cleans background,
 * finds ink boundaries, fits into 900x300 (3:1) transparent PNG, and validates size.
 */
export async function processSignatureImage(
  source: CanvasImageSource,
  width: number,
  height: number
): Promise<ProcessOutcome> {
  // a) draw source to a canvas width x height (white fill first) -> getImageData
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) {
    throw new Error('Canvas 2D context unavailable');
  }

  srcCtx.fillStyle = '#ffffff';
  srcCtx.fillRect(0, 0, width, height);
  srcCtx.drawImage(source, 0, 0, width, height);

  const img = srcCtx.getImageData(0, 0, width, height);

  // b) paper = estimatePaperLuminance(img); colour = classifyInkColour(img, paper)
  const paper = estimatePaperLuminance(img);
  const colour = classifyInkColour(img, paper);

  if (colour.verdict === 'none') {
    return { ok: false, reason: 'empty' };
  }
  if (colour.verdict === 'other') {
    return { ok: false, reason: 'wrong_colour' };
  }

  // c) { image: cleaned } = cleanSignature(img, { ink: colour.verdict, strength: 50 })
  const { image: cleaned } = cleanSignature(img, { ink: colour.verdict, strength: 50 });

  // d) bounds = findInkBounds(cleaned); a = assessSignature(bounds, width, height); if !a.ok return it
  const bounds = findInkBounds(cleaned);
  const a = assessSignature(bounds, width, height);
  if (!a.ok) {
    return a;
  }

  // e) rect = fitRectForSignature(bounds!)
  const rect = fitRectForSignature(bounds!);

  // f) put `cleaned` on a temp canvas (putImageData) -> dest canvas 900x300, clearRect (transparent), imageSmoothingQuality 'high', drawImage(temp, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, 900, 300)
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) {
    throw new Error('Canvas 2D context unavailable');
  }

  const tempImageData = tempCtx.createImageData(width, height);
  tempImageData.data.set(cleaned.data);
  tempCtx.putImageData(tempImageData, 0, 0);

  // g) B9b: signatures are stored at <= SIGNATURE_MAX_BYTES (20 KB). Keep a transparent 3:1 PNG (the server checks
  //    PNG + alpha + 3:1 + width 300..1500) and step the size down until it fits. 600 px wide is ~340 dpi at the
  //    printed size, so the smaller steps still print sharply.
  let dataUrl: string | null = null;
  for (const width of signatureOutputWidths()) {
    const height = Math.round(width / 3);
    const destCanvas = document.createElement('canvas');
    destCanvas.width = width;
    destCanvas.height = height;
    const destCtx = destCanvas.getContext('2d');
    if (!destCtx) {
      throw new Error('Canvas 2D context unavailable');
    }
    destCtx.clearRect(0, 0, width, height);
    destCtx.imageSmoothingEnabled = true;
    destCtx.imageSmoothingQuality = 'high';
    destCtx.drawImage(tempCanvas, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, width, height);
    // Resizing brings back many slightly different colour/alpha values, which PNG compresses badly. Re-apply the single
    // ink colour and round alpha to 16 levels: looks the same, but the file is several times smaller.
    const px = destCtx.getImageData(0, 0, width, height);
    quantiseInk(px.data, INK_COLOURS[colour.verdict]);
    destCtx.putImageData(px, 0, 0);

    const candidate = await canvasToPngDataUrl(destCanvas);
    const commaIdx = candidate.indexOf(',');
    const base64Data = commaIdx >= 0 ? candidate.slice(commaIdx + 1) : candidate;
    if (Math.ceil((base64Data.length * 3) / 4) <= SIGNATURE_MAX_BYTES) {
      dataUrl = candidate;
      break;
    }
  }
  if (!dataUrl) {
    return { ok: false, reason: 'too_large' };
  }

  // h) return { ok:true, dataUrl, ink: colour.verdict }
  return { ok: true, dataUrl, ink: colour.verdict };
}
