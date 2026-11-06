import { randomUUID } from 'node:crypto';
import { ActionError } from '@/lib/actions/_shared/errors';

export type UploadMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';
export type UploadExtension = 'png' | 'jpg' | 'webp' | 'pdf';

export interface DetectedType {
  readonly mime: UploadMime;
  readonly ext: UploadExtension;
}

export interface ValidatedUpload extends DetectedType {
  readonly buffer: Buffer;
  readonly sizeBytes: number;
}

export type UploadFailureCode = 'EMPTY' | 'INVALID_BASE64' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE';

export type UploadValidationResult =
  | { readonly ok: true; readonly upload: ValidatedUpload }
  | { readonly ok: false; readonly code: UploadFailureCode };

export interface UploadValidationOptions {
  readonly maxBytes: number;
  readonly allowed: readonly UploadMime[];
}

export const IMAGE_MIMES: readonly UploadMime[] = ['image/png', 'image/jpeg', 'image/webp'];
export const IMAGE_AND_PDF_MIMES: readonly UploadMime[] = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

const MIN_BYTES = 32;
const BASE64_EXPANSION = 1.37;
const DATA_URL_SLACK = 256;
const DATA_URL_PREFIX = /^data:[^;,]{1,100};base64,/i;
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

/** Maximum base64 characters worth parsing for a given decoded limit (cheap pre-decode guard for Zod schemas). */
export function maxBase64Chars(maxBytes: number): number {
  return Math.ceil(maxBytes * BASE64_EXPANSION) + DATA_URL_SLACK;
}

function hasAscii(buffer: Buffer, offset: number, text: string): boolean {
  if (buffer.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (buffer.readUInt8(offset + index) !== text.charCodeAt(index)) return false;
  }
  return true;
}

function isAsciiDigit(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x39;
}

/** Derives the real type from magic bytes. Never uses client-declared MIME or file names. */
export function detectUploadType(buffer: Buffer): DetectedType | null {
  if (buffer.length < MIN_BYTES) return null;

  // PNG: 8-byte signature followed by the IHDR chunk.
  if (
    buffer.readUInt8(0) === 0x89 && hasAscii(buffer, 1, 'PNG') &&
    buffer.readUInt8(4) === 0x0d && buffer.readUInt8(5) === 0x0a &&
    buffer.readUInt8(6) === 0x1a && buffer.readUInt8(7) === 0x0a &&
    hasAscii(buffer, 12, 'IHDR')
  ) {
    return { mime: 'image/png', ext: 'png' };
  }

  // JPEG: SOI + a marker byte (>= 0xC0).
  if (buffer.readUInt8(0) === 0xff && buffer.readUInt8(1) === 0xd8 && buffer.readUInt8(2) === 0xff && buffer.readUInt8(3) >= 0xc0) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }

  // WebP: RIFF container, WEBP form type, a known first chunk, and a RIFF size that fits the buffer.
  if (
    hasAscii(buffer, 0, 'RIFF') && hasAscii(buffer, 8, 'WEBP') &&
    (hasAscii(buffer, 12, 'VP8 ') || hasAscii(buffer, 12, 'VP8L') || hasAscii(buffer, 12, 'VP8X')) &&
    buffer.readUInt32LE(4) + 8 <= buffer.length
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }

  // PDF: "%PDF-<digit>.<digit>"
  if (hasAscii(buffer, 0, '%PDF-') && isAsciiDigit(buffer.readUInt8(5)) && buffer.readUInt8(6) === 0x2e && isAsciiDigit(buffer.readUInt8(7))) {
    return { mime: 'application/pdf', ext: 'pdf' };
  }

  return null;
}

/** Pure validation: strict base64, size limits BEFORE decoding, magic-byte type detection. */
export function validateUpload(base64Input: string, options: UploadValidationOptions): UploadValidationResult {
  if (base64Input.length > maxBase64Chars(options.maxBytes)) return { ok: false, code: 'TOO_LARGE' };

  const compact = base64Input.trim().replace(DATA_URL_PREFIX, '').replace(/\s+/g, '');
  if (compact === '') return { ok: false, code: 'EMPTY' };
  if (compact.length % 4 !== 0 || !BASE64_BODY.test(compact)) return { ok: false, code: 'INVALID_BASE64' };

  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  const decodedSize = (compact.length / 4) * 3 - padding;
  if (decodedSize > options.maxBytes) return { ok: false, code: 'TOO_LARGE' };

  const buffer = Buffer.from(compact, 'base64');
  if (buffer.length !== decodedSize) return { ok: false, code: 'INVALID_BASE64' };

  const detected = detectUploadType(buffer);
  if (detected === null || !options.allowed.includes(detected.mime)) return { ok: false, code: 'UNSUPPORTED_TYPE' };

  return { ok: true, upload: { ...detected, buffer, sizeBytes: buffer.length } };
}

function describeAllowed(allowed: readonly UploadMime[]): string {
  const labels: Record<UploadMime, string> = {
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
    'image/webp': 'WebP',
    'application/pdf': 'PDF',
  };
  return allowed.map((mime) => labels[mime]).join(', ');
}

function formatLimit(maxBytes: number): string {
  return `${Math.round((maxBytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** Validates and returns the upload, or throws a user-safe ActionError (never echoes the file or client metadata). */
export function requireValidUpload(base64Input: string, options: UploadValidationOptions): ValidatedUpload {
  const result = validateUpload(base64Input, options);
  if (result.ok) return result.upload;
  switch (result.code) {
    case 'TOO_LARGE':
      throw new ActionError(`The file is too large. The maximum size is ${formatLimit(options.maxBytes)}.`, { code: 'FILE_TOO_LARGE' });
    case 'EMPTY':
      throw new ActionError('The file is empty. Please choose a file and try again.', { code: 'INVALID_FILE' });
    case 'INVALID_BASE64':
      throw new ActionError('The file could not be read. Please choose it again.', { code: 'INVALID_FILE' });
    case 'UNSUPPORTED_TYPE':
      throw new ActionError(`Unsupported or invalid file. Allowed types: ${describeAllowed(options.allowed)}.`, { code: 'UNSUPPORTED_FILE_TYPE' });
    default: {
      const exhaustiveCheck: never = result.code;
      throw new Error(`Unhandled upload failure code: ${String(exhaustiveCheck)}`);
    }
  }
}

/** Server-generated storage key: `<prefix>/<uuid>.<ext>` (never derived from user input). */
export function buildUploadKey(prefix: string, ext: UploadExtension): string {
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9/_-]{1,200}$/.test(cleanPrefix)) throw new Error('Invalid upload key prefix.');
  return `${cleanPrefix}/${randomUUID()}.${ext}`;
}

const MAX_FILENAME_LENGTH = 80;

function sanitiseStem(original: string): string {
  const baseName = original.split(/[\\/]/).pop() ?? '';
  const withoutExtension = baseName.replace(/\.[^.]*$/, '');
  return withoutExtension
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '');
}

/** Output always matches ^[A-Za-z0-9._-]{1,80}$ and ends with the server-derived extension. */
export function sanitizeFilename(original: string, ext: UploadExtension): string {
  const maxStem = MAX_FILENAME_LENGTH - (ext.length + 1);
  const stem = sanitiseStem(original).slice(0, maxStem).replace(/[._-]+$/g, '') || 'attachment';
  return `${stem}.${ext}`;
}

/** Sanitises a batch and guarantees unique names (`name.png`, `name-2.png`, ...). */
export function makeAttachmentFilenames(items: readonly { readonly original: string; readonly ext: UploadExtension }[]): string[] {
  const used = new Set<string>();
  return items.map((item) => {
    const first = sanitizeFilename(item.original, item.ext);
    if (!used.has(first)) {
      used.add(first);
      return first;
    }
    const stem = first.slice(0, first.length - (item.ext.length + 1));
    for (let counter = 2; ; counter += 1) {
      const suffix = `-${counter}`;
      const candidate = `${stem.slice(0, MAX_FILENAME_LENGTH - (item.ext.length + 1) - suffix.length)}${suffix}.${item.ext}`;
      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }
  });
}

