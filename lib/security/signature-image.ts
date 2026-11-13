/**
 * Authorised signature image validation rules (pure, server-side).
 * Validates PNG signature, IHDR dimensions, aspect ratio, and RGBA alpha channel.
 */

import {
  SIGNATURE_MAX_BYTES,
  SIGNATURE_MIN_WIDTH_PX,
  SIGNATURE_MAX_WIDTH_PX,
} from './signature-limits';

export {
  SIGNATURE_MAX_BYTES,
  SIGNATURE_MIN_WIDTH_PX,
  SIGNATURE_MAX_WIDTH_PX,
};

export type SignatureValidationError = {
  readonly ok: false;
  readonly code: 'NOT_PNG' | 'NO_ALPHA' | 'BAD_RATIO' | 'BAD_SIZE';
  readonly message: string;
};

export type SignatureValidationSuccess = {
  readonly ok: true;
  readonly width: number;
  readonly height: number;
};

export type SignatureValidationResult = SignatureValidationSuccess | SignatureValidationError;

/**
 * Validates that a buffer is a real PNG image matching the authorised signature rules:
 * - Valid 8-byte PNG signature followed by an IHDR chunk
 * - Colour type 6 (RGBA, transparent background)
 * - Exact 3:1 aspect ratio (width = 3 * height)
 * - Width between 300px and 1500px
 */
export function validateSignaturePng(buffer: Buffer): SignatureValidationResult {
  // Minimum bytes required to read colour type (byte 25): 8 sig + 4 len + 4 IHDR + 4 width + 4 height + 1 bit depth + 1 colour type = 26 bytes
  if (
    buffer.length < 26 ||
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 || // P
    buffer[2] !== 0x4e || // N
    buffer[3] !== 0x47 || // G
    buffer[4] !== 0x0d ||
    buffer[5] !== 0x0a ||
    buffer[6] !== 0x1a ||
    buffer[7] !== 0x0a ||
    buffer[12] !== 0x49 || // I
    buffer[13] !== 0x48 || // H
    buffer[14] !== 0x44 || // D
    buffer[15] !== 0x52    // R
  ) {
    return {
      ok: false,
      code: 'NOT_PNG',
      message: 'The signature must be a valid PNG image.',
    };
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colourType = buffer.readUInt8(25);

  // Colour type 6 is RGBA (Truecolour with alpha channel)
  if (colourType !== 6) {
    return {
      ok: false,
      code: 'NO_ALPHA',
      message: 'The signature must have a transparent background (PNG with alpha channel).',
    };
  }

  // Width must be EXACTLY 3 x height (3:1 aspect ratio)
  if (width !== 3 * height) {
    return {
      ok: false,
      code: 'BAD_RATIO',
      message: 'The signature must be a 3:1 image (for example 900 x 300 pixels).',
    };
  }

  // Width must be within [SIGNATURE_MIN_WIDTH_PX, SIGNATURE_MAX_WIDTH_PX]
  if (width < SIGNATURE_MIN_WIDTH_PX || width > SIGNATURE_MAX_WIDTH_PX) {
    return {
      ok: false,
      code: 'BAD_SIZE',
      message: `The signature width must be between ${SIGNATURE_MIN_WIDTH_PX} and ${SIGNATURE_MAX_WIDTH_PX} pixels.`,
    };
  }

  return {
    ok: true,
    width,
    height,
  };
}

