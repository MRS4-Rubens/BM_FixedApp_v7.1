'use client';

import {
  cleanSignature,
  classifyInkColour,
  estimatePaperLuminance,
  findInkBounds,
  assessSignature,
  fitRectForSignature,
  type SignatureRejection,
  SIGNATURE_OUTPUT_HEIGHT,
  SIGNATURE_OUTPUT_WIDTH,
} from '@/lib/signature/process-signature';
import { SIGNATURE_MAX_BYTES } from '@/lib/security/signature-limits';

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

  const destCanvas = document.createElement('canvas');
  destCanvas.width = SIGNATURE_OUTPUT_WIDTH;
  destCanvas.height = SIGNATURE_OUTPUT_HEIGHT;
  const destCtx = destCanvas.getContext('2d');
  if (!destCtx) {
    throw new Error('Canvas 2D context unavailable');
  }

  destCtx.clearRect(0, 0, SIGNATURE_OUTPUT_WIDTH, SIGNATURE_OUTPUT_HEIGHT);
  destCtx.imageSmoothingEnabled = true;
  destCtx.imageSmoothingQuality = 'high';
  destCtx.drawImage(
    tempCanvas,
    rect.sx,
    rect.sy,
    rect.sw,
    rect.sh,
    0,
    0,
    SIGNATURE_OUTPUT_WIDTH,
    SIGNATURE_OUTPUT_HEIGHT
  );

  // g) dest -> PNG data URL (keep the existing canvasToPngDataUrl helper); if approx bytes > SIGNATURE_MAX_BYTES -> { ok:false, reason:'too_large' }
  const dataUrl = await canvasToPngDataUrl(destCanvas);
  const commaIdx = dataUrl.indexOf(',');
  const base64Data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const approxBytes = Math.ceil((base64Data.length * 3) / 4);

  if (approxBytes > SIGNATURE_MAX_BYTES) {
    return { ok: false, reason: 'too_large' };
  }

  // h) return { ok:true, dataUrl, ink: colour.verdict }
  return { ok: true, dataUrl, ink: colour.verdict };
}
