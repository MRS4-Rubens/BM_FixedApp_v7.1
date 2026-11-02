import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  renderUrlToPdfBuffer,
  PdfRenderError,
} from '@/lib/pdf/html-to-pdf-provider';
import { EnvConfigError } from '@/lib/env';

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...actual,
    getPdfEnv: vi.fn(() => ({
      HTML_TO_PDF_API_KEY: 'test-api-key-12345',
    })),
  };
});

import { getPdfEnv } from '@/lib/env';

describe('renderUrlToPdfBuffer provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aborts and throws PdfRenderError with kind timeout when signal aborts', async () => {
    const fetchImpl: typeof fetch = vi.fn().mockImplementation(() => {
      const err = new DOMException('The operation was aborted.', 'TimeoutError');
      return Promise.reject(err);
    });

    await expect(
      renderUrlToPdfBuffer('https://example.com/render', { fetchImpl, timeoutMs: 100 }),
    ).rejects.toThrow(PdfRenderError);

    try {
      await renderUrlToPdfBuffer('https://example.com/render', { fetchImpl, timeoutMs: 100 });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(PdfRenderError);
      if (err instanceof PdfRenderError) {
        expect(err.kind).toBe('timeout');
      }
    }
  });

  it('throws PdfRenderError with kind http, status, and truncated message without secret or URL', async () => {
    const longError = 'E'.repeat(300);
    const fetchImpl: typeof fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => `Bad Gateway ${longError}`,
    } as unknown as Response);

    try {
      await renderUrlToPdfBuffer('https://example.com/render?token=sensitive-token-abc', { fetchImpl });
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(PdfRenderError);
      if (err instanceof PdfRenderError) {
        expect(err.kind).toBe('http');
        expect(err.status).toBe(502);
        expect(err.message).not.toContain('test-api-key-12345');
        expect(err.message).not.toContain('sensitive-token-abc');
        expect(err.message.length).toBeLessThan(300);
      }
    }
  });

  it('throws invalid_response when body is not a valid PDF (%PDF- header missing)', async () => {
    const fetchImpl: typeof fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from('<html><body>Hello</body></html>'),
    } as unknown as Response);

    await expect(
      renderUrlToPdfBuffer('https://example.com/render', { fetchImpl }),
    ).rejects.toThrow('PDF vendor returned a response that is not a valid PDF.');
  });

  it('throws invalid_response when body is empty', async () => {
    const fetchImpl: typeof fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from(''),
    } as unknown as Response);

    await expect(
      renderUrlToPdfBuffer('https://example.com/render', { fetchImpl }),
    ).rejects.toThrow('PDF vendor returned a response that is not a valid PDF.');
  });

  it('returns Buffer when vendor returns valid PDF bytes', async () => {
    const validPdfBytes = Buffer.from('%PDF-1.7 fake pdf binary content');
    const fetchImpl: typeof fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => validPdfBytes,
    } as unknown as Response);

    const result = await renderUrlToPdfBuffer('https://example.com/render', { fetchImpl });
    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString('latin1')).toContain('%PDF-1.7');
  });

  it('propagates EnvConfigError when getPdfEnv throws', async () => {
    vi.mocked(getPdfEnv).mockImplementationOnce(() => {
      throw new EnvConfigError([
        { group: 'pdf', name: 'HTML_TO_PDF_API_KEY', message: 'is required' },
      ]);
    });

    await expect(renderUrlToPdfBuffer('https://example.com/render')).rejects.toThrow(EnvConfigError);
  });
});
