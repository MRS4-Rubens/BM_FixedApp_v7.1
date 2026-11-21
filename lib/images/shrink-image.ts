/**
 * B9b: shrink an uploaded picture in the browser until it fits a strict size limit, so people never have to make small
 * files themselves and IDrive e2 / PDFs stay light. The server still enforces the same limit (never trust the browser).
 *
 * Tries the largest size first and lowers quality, then steps the size down, until the encoded image is within maxBytes.
 * Prefers WebP (small, keeps transparency); falls back to JPEG on browsers that cannot encode WebP.
 */

export interface ShrinkOptions {
  /** Hard limit for the encoded file. */
  readonly maxBytes: number;
  /** Longest side to start from (never upscales). */
  readonly maxEdge: number;
  /** Smallest longest side worth trying (below this the picture stops being useful). */
  readonly minEdge: number;
  /** JPEG has no transparency: transparent areas are filled with this colour. */
  readonly jpegBackground?: string;
}

export interface ShrinkAttempt {
  readonly edge: number;
  readonly quality: number;
}

export interface ShrunkImage {
  readonly blob: Blob;
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly mime: 'image/webp' | 'image/jpeg';
}

const QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5, 0.42, 0.35] as const;
const EDGE_STEP = 0.8;

/** PURE: the order of (size, quality) tries, largest and sharpest first. Exported for tests. */
export function shrinkAttempts(maxEdge: number, minEdge: number): ShrinkAttempt[] {
  const attempts: ShrinkAttempt[] = [];
  let edge = Math.max(1, Math.round(maxEdge));
  const floor = Math.max(1, Math.round(minEdge));
  for (;;) {
    for (const quality of QUALITIES) attempts.push({ edge, quality });
    if (edge <= floor) break;
    edge = Math.max(floor, Math.round(edge * EDGE_STEP));
  }
  return attempts;
}

/** PURE: target size keeping the aspect ratio, never larger than the source. */
export function fitWithin(width: number, height: number, edge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= edge) return { width, height };
  const scale = edge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, quality));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image'));
    reader.readAsDataURL(blob);
  });
}

/** Returns the shrunk image, or null when even the smallest useful size cannot fit (or the file is not a picture). */
export async function shrinkImage(file: Blob, options: ShrinkOptions): Promise<ShrunkImage | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    let mime: 'image/webp' | 'image/jpeg' = 'image/webp';
    for (const attempt of shrinkAttempts(options.maxEdge, options.minEdge)) {
      const size = fitWithin(bitmap.width, bitmap.height, attempt.edge);
      canvas.width = size.width;
      canvas.height = size.height;
      ctx.clearRect(0, 0, size.width, size.height);
      if (mime === 'image/jpeg') {
        ctx.fillStyle = options.jpegBackground ?? '#ffffff';
        ctx.fillRect(0, 0, size.width, size.height);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);

      let blob = await toBlob(canvas, mime, attempt.quality);
      if (blob && mime === 'image/webp' && blob.type !== 'image/webp') {
        // This browser cannot encode WebP: switch to JPEG for this and every later try.
        mime = 'image/jpeg';
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = options.jpegBackground ?? '#ffffff';
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.globalCompositeOperation = 'source-over';
        blob = await toBlob(canvas, mime, attempt.quality);
      }
      if (blob && blob.size <= options.maxBytes) {
        return { blob, dataUrl: await blobToDataUrl(blob), width: size.width, height: size.height, mime };
      }
    }
    return null;
  } finally {
    bitmap.close();
  }
}

/** "28 KB", "1.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
