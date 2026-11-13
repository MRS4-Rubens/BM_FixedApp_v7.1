'use client';

import {
  cleanSignature,
  detectInkColour,
  estimatePaperLuminance,
  type InkColour,
  SIGNATURE_OUTPUT_HEIGHT,
  SIGNATURE_OUTPUT_WIDTH,
  validateCoverage,
} from '@/lib/signature/process-signature';

export interface CropAreaPixels {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProcessedSignatureResult {
  dataUrl: string;
  coverage: number;
  validation: { ok: true } | { ok: false; reason: 'empty' | 'too_much' };
}

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
 * Calculates rotated bounding box dimensions.
 */
function rotateSize(width: number, height: number, rotation: number): { width: number; height: number } {
  const rotRad = (rotation * Math.PI) / 180;
  return {
    width: Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height: Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
  };
}

/**
 * Samples the image to detect the dominant ink colour (blue vs black).
 */
export function detectDefaultInkColour(
  image: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number
): InkColour {
  try {
    const thumbCanvas = document.createElement('canvas');
    const w = Math.min(300, naturalWidth);
    const h = Math.max(1, Math.round((w / naturalWidth) * naturalHeight));
    thumbCanvas.width = w;
    thumbCanvas.height = h;
    const ctx = thumbCanvas.getContext('2d');
    if (!ctx) return 'black';

    ctx.drawImage(image, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const paperLum = estimatePaperLuminance(imgData);
    return detectInkColour(imgData, paperLum);
  } catch {
    return 'black';
  }
}

/**
 * Crops, rotates, cleans background, and recolours ink onto a 900x300 RGBA PNG.
 */
export async function renderProcessedSignature({
  image,
  naturalWidth,
  naturalHeight,
  cropAreaPixels,
  rotation,
  ink,
  strength,
}: {
  image: CanvasImageSource;
  naturalWidth: number;
  naturalHeight: number;
  cropAreaPixels: CropAreaPixels;
  rotation: number;
  ink: InkColour;
  strength: number;
}): Promise<ProcessedSignatureResult> {
  const rotRad = (rotation * Math.PI) / 180;
  const { width: bBoxWidth, height: bBoxHeight } = rotateSize(naturalWidth, naturalHeight, rotation);

  // 1. Draw rotated source to intermediate canvas
  const rotCanvas = document.createElement('canvas');
  rotCanvas.width = Math.max(1, Math.round(bBoxWidth));
  rotCanvas.height = Math.max(1, Math.round(bBoxHeight));
  const rotCtx = rotCanvas.getContext('2d');
  if (!rotCtx) {
    throw new Error('Canvas 2D context unavailable');
  }

  rotCtx.translate(bBoxWidth / 2, bBoxHeight / 2);
  rotCtx.rotate(rotRad);
  rotCtx.translate(-naturalWidth / 2, -naturalHeight / 2);
  rotCtx.drawImage(image, 0, 0);

  // 2. Draw cropped area onto 900x300 destination canvas (white fill first)
  const destCanvas = document.createElement('canvas');
  destCanvas.width = SIGNATURE_OUTPUT_WIDTH;
  destCanvas.height = SIGNATURE_OUTPUT_HEIGHT;
  const destCtx = destCanvas.getContext('2d');
  if (!destCtx) {
    throw new Error('Canvas 2D context unavailable');
  }

  destCtx.fillStyle = '#ffffff';
  destCtx.fillRect(0, 0, SIGNATURE_OUTPUT_WIDTH, SIGNATURE_OUTPUT_HEIGHT);
  destCtx.imageSmoothingEnabled = true;
  destCtx.imageSmoothingQuality = 'high';

  destCtx.drawImage(
    rotCanvas,
    cropAreaPixels.x,
    cropAreaPixels.y,
    cropAreaPixels.width,
    cropAreaPixels.height,
    0,
    0,
    SIGNATURE_OUTPUT_WIDTH,
    SIGNATURE_OUTPUT_HEIGHT
  );

  // 3. Clean background and extract transparent RGBA ink
  const imgData = destCtx.getImageData(0, 0, SIGNATURE_OUTPUT_WIDTH, SIGNATURE_OUTPUT_HEIGHT);
  const { image: cleaned, coverage } = cleanSignature(imgData, { ink, strength });

  // 4. Put transparent ink pixels back to output canvas
  destCtx.clearRect(0, 0, SIGNATURE_OUTPUT_WIDTH, SIGNATURE_OUTPUT_HEIGHT);
  const outputImgData = destCtx.createImageData(SIGNATURE_OUTPUT_WIDTH, SIGNATURE_OUTPUT_HEIGHT);
  outputImgData.data.set(cleaned.data);
  destCtx.putImageData(outputImgData, 0, 0);

  // 5. Output data URL (RGBA PNG, colour type 6)
  const dataUrl = await canvasToPngDataUrl(destCanvas);
  const validation = validateCoverage(coverage);

  return {
    dataUrl,
    coverage,
    validation,
  };
}
