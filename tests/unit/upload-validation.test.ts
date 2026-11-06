import { describe, it, expect } from 'vitest';
import {
  validateUpload,
  requireValidUpload,
  buildUploadKey,
  IMAGE_MIMES,
  IMAGE_AND_PDF_MIMES,
} from '@/lib/security/upload';
import { ActionError } from '@/lib/actions/_shared/errors';

function makePngFixture(extraBytes = 0): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]),
    Buffer.from('IHDR'),
    Buffer.alloc(17 + extraBytes),
  ]);
}

function makeJpegFixture(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]),
    Buffer.from('JFIF'),
    Buffer.alloc(40),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function makeWebpFixture(): Buffer {
  const payload = Buffer.concat([Buffer.from('WEBP'), Buffer.from('VP8 '), Buffer.alloc(40)]);
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32LE(payload.length);
  return Buffer.concat([Buffer.from('RIFF'), sizeBuf, payload]);
}

function makePdfFixture(): Buffer {
  return Buffer.from('%PDF-1.7\n' + 'x'.repeat(60) + '\n%%EOF');
}

describe('Upload Validation Layer (SEC-002)', () => {
  const pngBuf = makePngFixture();
  const jpegBuf = makeJpegFixture();
  const webpBuf = makeWebpFixture();
  const pdfBuf = makePdfFixture();

  it('accepts valid PNG, JPEG, WebP, and PDF with server-derived MIME and extension', () => {
    const pngRes = validateUpload(pngBuf.toString('base64'), { maxBytes: 1024 * 1024, allowed: IMAGE_MIMES });
    expect(pngRes.ok).toBe(true);
    if (pngRes.ok) {
      expect(pngRes.upload.mime).toBe('image/png');
      expect(pngRes.upload.ext).toBe('png');
      expect(pngRes.upload.sizeBytes).toBe(pngBuf.length);
    }

    const jpegRes = validateUpload(jpegBuf.toString('base64'), { maxBytes: 1024 * 1024, allowed: IMAGE_MIMES });
    expect(jpegRes.ok).toBe(true);
    if (jpegRes.ok) {
      expect(jpegRes.upload.mime).toBe('image/jpeg');
      expect(jpegRes.upload.ext).toBe('jpg');
    }

    const webpRes = validateUpload(webpBuf.toString('base64'), { maxBytes: 1024 * 1024, allowed: IMAGE_MIMES });
    expect(webpRes.ok).toBe(true);
    if (webpRes.ok) {
      expect(webpRes.upload.mime).toBe('image/webp');
      expect(webpRes.upload.ext).toBe('webp');
    }

    const pdfRes = validateUpload(pdfBuf.toString('base64'), { maxBytes: 1024 * 1024, allowed: IMAGE_AND_PDF_MIMES });
    expect(pdfRes.ok).toBe(true);
    if (pdfRes.ok) {
      expect(pdfRes.upload.mime).toBe('application/pdf');
      expect(pdfRes.upload.ext).toBe('pdf');
    }
  });

  it('ignores declared client data-URL prefix and respects magic bytes', () => {
    const wrapped = `data:image/jpeg;base64,${pngBuf.toString('base64')}`;
    const res = validateUpload(wrapped, { maxBytes: 1024 * 1024, allowed: IMAGE_MIMES });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.upload.mime).toBe('image/png');
      expect(res.upload.ext).toBe('png');
    }

    const customWrapped = `data:application/pdf;base64,${webpBuf.toString('base64')}`;
    const customRes = validateUpload(customWrapped, { maxBytes: 1024 * 1024, allowed: IMAGE_MIMES });
    expect(customRes.ok).toBe(true);
    if (customRes.ok) {
      expect(customRes.upload.mime).toBe('image/webp');
      expect(customRes.upload.ext).toBe('webp');
    }
  });

  it('rejects invalid or unsupported file types as UNSUPPORTED_TYPE', () => {
    const options = { maxBytes: 1024 * 1024, allowed: IMAGE_MIMES };

    // HTML with script
    const htmlBuf = Buffer.from('<html><script>alert(1)</script></html>\n'.repeat(2));
    expect(validateUpload(htmlBuf.toString('base64'), options)).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' });

    // SVG
    const svgBuf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="50"/></svg>\n');
    expect(validateUpload(svgBuf.toString('base64'), options)).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' });

    // GIF (GIF89a)
    const gifBuf = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(30)]);
    expect(validateUpload(gifBuf.toString('base64'), options)).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' });

    // Plain text file
    const textBuf = Buffer.from('This is a plain text file that is long enough to exceed minimum bytes.');
    expect(validateUpload(textBuf.toString('base64'), options)).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' });

    // PNG signature WITHOUT IHDR chunk
    const fakePng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('NO_HEADER_CHUNK_PADDING_DATA_HERE'),
    ]);
    expect(validateUpload(fakePng.toString('base64'), options)).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' });

    // JPEG signature with marker byte below 0xC0
    const fakeJpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0x50]), // 0x50 < 0xC0
      Buffer.alloc(30),
    ]);
    expect(validateUpload(fakeJpeg.toString('base64'), options)).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' });

    // Truncated (< 32 bytes)
    const truncatedBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    expect(validateUpload(truncatedBuf.toString('base64'), options)).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' });

    // RIFF without WEBP
    const fakeRiff = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(30)]);
    expect(validateUpload(fakeRiff.toString('base64'), options)).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' });

    // PDF when allowed = IMAGE_MIMES
    expect(validateUpload(pdfBuf.toString('base64'), { maxBytes: 1024 * 1024, allowed: IMAGE_MIMES })).toEqual({
      ok: false,
      code: 'UNSUPPORTED_TYPE',
    });
  });

  it('rejects empty or whitespace-only base64 input with code EMPTY', () => {
    const opts = { maxBytes: 1024 * 1024, allowed: IMAGE_MIMES };
    expect(validateUpload('', opts)).toEqual({ ok: false, code: 'EMPTY' });
    expect(validateUpload('   \n\t  ', opts)).toEqual({ ok: false, code: 'EMPTY' });
    expect(validateUpload('data:image/png;base64,  ', opts)).toEqual({ ok: false, code: 'EMPTY' });
  });

  it('rejects malformed base64 input with code INVALID_BASE64', () => {
    const opts = { maxBytes: 1024 * 1024, allowed: IMAGE_MIMES };
    expect(validateUpload('!!!!', opts)).toEqual({ ok: false, code: 'INVALID_BASE64' });
    expect(validateUpload('abcde', opts)).toEqual({ ok: false, code: 'INVALID_BASE64' }); // length % 4 !== 0
    expect(validateUpload('ab=cdef=', opts)).toEqual({ ok: false, code: 'INVALID_BASE64' }); // = in middle
  });

  it('accepts base64 strings containing newline / whitespace formatting', () => {
    const raw = pngBuf.toString('base64');
    const wrapped = `${raw.slice(0, 20)}\n  ${raw.slice(20, 40)}\r\n ${raw.slice(40)}`;
    const res = validateUpload(wrapped, { maxBytes: 1024 * 1024, allowed: IMAGE_MIMES });
    expect(res.ok).toBe(true);
  });

  it('enforces exact byte limits and raw-length pre-decode bounds', () => {
    // 50 MB string of 'A' with maxBytes = 1 MB -> pre-decode guard rejects immediately without decoding
    const giantBase64 = 'A'.repeat(50 * 1024 * 1024);
    const resGiant = validateUpload(giantBase64, { maxBytes: 1024 * 1024, allowed: IMAGE_MIMES });
    expect(resGiant).toEqual({ ok: false, code: 'TOO_LARGE' });

    // Exact byte limits
    const exactMaxBytes = pngBuf.length;
    const exactRes = validateUpload(pngBuf.toString('base64'), { maxBytes: exactMaxBytes, allowed: IMAGE_MIMES });
    expect(exactRes.ok).toBe(true);

    const overRes = validateUpload(pngBuf.toString('base64'), { maxBytes: exactMaxBytes - 1, allowed: IMAGE_MIMES });
    expect(overRes).toEqual({ ok: false, code: 'TOO_LARGE' });

    // Exactly 1 extra byte rejected
    const pngPlusOne = makePngFixture(1);
    const overOneRes = validateUpload(pngPlusOne.toString('base64'), { maxBytes: exactMaxBytes, allowed: IMAGE_MIMES });
    expect(overOneRes).toEqual({ ok: false, code: 'TOO_LARGE' });
  });

  it('requireValidUpload throws specific ActionErrors that never echo file data or client hints', () => {
    const opts = { maxBytes: 1024, allowed: IMAGE_MIMES };

    // TOO_LARGE
    try {
      requireValidUpload('A'.repeat(5000), opts);
      expect.fail('Should have thrown ActionError');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ActionError);
      const actionErr = err as ActionError;
      expect(actionErr.code).toBe('FILE_TOO_LARGE');
      expect(actionErr.message).toContain('The file is too large');
      expect(actionErr.message).not.toContain('A'.repeat(20));
    }

    // EMPTY
    try {
      requireValidUpload('', opts);
      expect.fail('Should have thrown ActionError');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ActionError);
      const actionErr = err as ActionError;
      expect(actionErr.code).toBe('INVALID_FILE');
      expect(actionErr.message).toContain('empty');
    }

    // INVALID_BASE64
    try {
      requireValidUpload('invalid_base64_symbols!!', opts);
      expect.fail('Should have thrown ActionError');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ActionError);
      const actionErr = err as ActionError;
      expect(actionErr.code).toBe('INVALID_FILE');
      expect(actionErr.message).toContain('could not be read');
      expect(actionErr.message).not.toContain('invalid_base64_symbols');
    }

    // UNSUPPORTED_TYPE
    try {
      const htmlBuf = Buffer.from('<html><body>not an image</body></html>\n'.repeat(2));
      requireValidUpload(htmlBuf.toString('base64'), opts);
      expect.fail('Should have thrown ActionError');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ActionError);
      const actionErr = err as ActionError;
      expect(actionErr.code).toBe('UNSUPPORTED_FILE_TYPE');
      expect(actionErr.message).toContain('Unsupported or invalid file');
      expect(actionErr.message).toContain('Allowed types: PNG, JPEG, WebP');
      expect(actionErr.message).not.toContain('html');
    }
  });

  it('buildUploadKey generates server-side UUID keys and validates prefix', () => {
    const key1 = buildUploadKey('payment-screenshots/biz-123', 'png');
    const key2 = buildUploadKey('payment-screenshots/biz-123', 'png');

    expect(key1).toMatch(/^payment-screenshots\/biz-123\/[0-9a-f-]{36}\.png$/);
    expect(key2).toMatch(/^payment-screenshots\/biz-123\/[0-9a-f-]{36}\.png$/);
    expect(key1).not.toBe(key2);

    // Strips slashes in prefix
    const keyWithSlashes = buildUploadKey('/logos/biz-456/', 'webp');
    expect(keyWithSlashes).toMatch(/^logos\/biz-456\/[0-9a-f-]{36}\.webp$/);

    // Invalid prefix throws
    expect(() => buildUploadKey('invalid$prefix#bad', 'jpg')).toThrow('Invalid upload key prefix.');
  });
});
