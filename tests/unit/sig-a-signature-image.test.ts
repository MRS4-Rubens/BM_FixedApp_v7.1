import { describe, expect, it } from 'vitest';
import {
  SIGNATURE_MAX_BYTES,
  SIGNATURE_MAX_WIDTH_PX,
  SIGNATURE_MIN_WIDTH_PX,
  validateSignaturePng,
} from '@/lib/security/signature-image';

function makePngHeader(width: number, height: number, colourType = 6): Buffer {
  const buf = Buffer.alloc(33);
  // PNG Signature: 89 50 4E 47 0D 0A 1A 0A
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  // IHDR chunk length: 13
  buf.writeUInt32BE(13, 8);
  // Chunk type: IHDR
  buf.write('IHDR', 12, 'ascii');
  // Dimensions
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  // Bit depth
  buf.writeUInt8(8, 24);
  // Colour type
  buf.writeUInt8(colourType, 25);
  // Compression (0), filter (0), interlace (0)
  buf.writeUInt8(0, 26);
  buf.writeUInt8(0, 27);
  buf.writeUInt8(0, 28);
  // CRC
  buf.writeUInt32BE(0, 29);
  return buf;
}

describe('SPEC: Authorised signature image validation (SIG-A)', () => {
  it('exports expected constants', () => {
    expect(SIGNATURE_MAX_BYTES).toBe(20 * 1024);
    expect(SIGNATURE_MIN_WIDTH_PX).toBe(300);
    expect(SIGNATURE_MAX_WIDTH_PX).toBe(1500);
  });

  it('valid 900x300 RGBA PNG returns ok with dimensions', () => {
    const png = makePngHeader(900, 300, 6);
    const result = validateSignaturePng(png);
    expect(result).toEqual({
      ok: true,
      width: 900,
      height: 300,
    });
  });

  it('non-PNG bytes (such as JPEG) return NOT_PNG', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const result = validateSignaturePng(jpeg);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_PNG');
      expect(result.message).toMatch(/PNG/i);
    }
  });

  it('truncated buffer returns NOT_PNG', () => {
    const short = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const result = validateSignaturePng(short);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_PNG');
    }
  });

  it('RGB PNG without alpha channel (colour type 2) returns NO_ALPHA', () => {
    const rgbPng = makePngHeader(900, 300, 2);
    const result = validateSignaturePng(rgbPng);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NO_ALPHA');
      expect(result.message).toMatch(/alpha|transparent/i);
    }
  });

  it('non-3:1 ratio (900x301) returns BAD_RATIO', () => {
    const badRatioPng = makePngHeader(900, 301, 6);
    const result = validateSignaturePng(badRatioPng);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('BAD_RATIO');
      expect(result.message).toMatch(/3:1/i);
    }
  });

  it('width below minimum (270x90) returns BAD_SIZE', () => {
    const tooSmallPng = makePngHeader(270, 90, 6);
    const result = validateSignaturePng(tooSmallPng);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('BAD_SIZE');
      expect(result.message).toContain('300');
    }
  });

  it('width above maximum (1800x600) returns BAD_SIZE', () => {
    const tooLargePng = makePngHeader(1800, 600, 6);
    const result = validateSignaturePng(tooLargePng);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('BAD_SIZE');
      expect(result.message).toContain('1500');
    }
  });
});

