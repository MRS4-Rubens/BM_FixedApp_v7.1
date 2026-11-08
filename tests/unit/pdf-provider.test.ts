import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  renderHtmlToPdfBuffer,
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

describe('renderHtmlToPdfBuffer provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends correct POST request with headers and payload, returning Buffer on valid PDF', async () => {
    let capturedUrl = '';
    let capturedOptions: RequestInit | undefined;

    const validPdfBytes = Buffer.from('%PDF-1.7 sample pdf content');
    const fetchImpl: typeof fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedOptions = init;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => validPdfBytes,
      } as unknown as Response;
    });

    const sampleHtml = '<html><body><h1>Invoice #1</h1></body></html>';
    const result = await renderHtmlToPdfBuffer(sampleHtml, { fetchImpl, timeoutMs: 5000 });

    expect(capturedUrl).toBe('https://e.customjs.io/html2pdf');
    expect(capturedOptions?.method).toBe('POST');
    const headers = capturedOptions?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Accept']).toBe('application/pdf');
    expect(headers['x-api-key']).toBe('test-api-key-12345');

    const parsedBody = JSON.parse(String(capturedOptions?.body));
    expect(parsedBody).toEqual({
      input: {
        html: sampleHtml,
        config: { pdfWidthMm: 210, pdfHeightMm: 297 },
      },
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString('latin1')).toContain('%PDF-1.7');
  });

  it('throws invalid_input when html exceeds 8 MB cap and does not call fetch', async () => {
    const fetchImpl = vi.fn();
    // 8 MB + 1 byte
    const largeHtml = 'a'.repeat(8 * 1024 * 1024 + 1);

    await expect(
      renderHtmlToPdfBuffer(largeHtml, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({
      name: 'PdfRenderError',
      kind: 'invalid_input',
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('aborts and throws PdfRenderError with kind timeout when signal aborts', async () => {
    const fetchImpl: typeof fetch = vi.fn().mockImplementation(() => {
      const err = new DOMException('The operation was aborted.', 'TimeoutError');
      return Promise.reject(err);
    });

    try {
      await renderHtmlToPdfBuffer('<html></html>', { fetchImpl, timeoutMs: 100 });
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(PdfRenderError);
      if (err instanceof PdfRenderError) {
        expect(err.kind).toBe('timeout');
      }
    }
  });

  it('throws PdfRenderError with kind http, status, and redacted error message', async () => {
    const sensitiveError = 'Error with customer_email=test@example.com and gstin=27AAPFU0939F1ZV';
    const fetchImpl: typeof fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => `Bad Gateway: ${sensitiveError}`,
    } as unknown as Response);

    try {
      await renderHtmlToPdfBuffer('<html></html>', { fetchImpl });
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(PdfRenderError);
      if (err instanceof PdfRenderError) {
        expect(err.kind).toBe('http');
        expect(err.status).toBe(502);
        expect(err.message).not.toContain('test@example.com');
        expect(err.message).not.toContain('27AAPFU0939F1ZV');
        expect(err.message).toContain('[redacted]');
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
      renderHtmlToPdfBuffer('<html></html>', { fetchImpl }),
    ).rejects.toMatchObject({
      name: 'PdfRenderError',
      kind: 'invalid_response',
    });
  });

  it('throws invalid_response when body is empty', async () => {
    const fetchImpl: typeof fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from(''),
    } as unknown as Response);

    await expect(
      renderHtmlToPdfBuffer('<html></html>', { fetchImpl }),
    ).rejects.toMatchObject({
      name: 'PdfRenderError',
      kind: 'invalid_response',
    });
  });

  it('throws network error when fetch rejects with general error', async () => {
    const fetchImpl: typeof fetch = vi.fn().mockRejectedValue(new Error('connection refused'));

    await expect(
      renderHtmlToPdfBuffer('<html></html>', { fetchImpl }),
    ).rejects.toMatchObject({
      name: 'PdfRenderError',
      kind: 'network',
    });
  });

  it('propagates EnvConfigError when getPdfEnv throws', async () => {
    vi.mocked(getPdfEnv).mockImplementationOnce(() => {
      throw new EnvConfigError([
        { group: 'pdf', name: 'HTML_TO_PDF_API_KEY', message: 'is required' },
      ]);
    });

    await expect(renderHtmlToPdfBuffer('<html></html>')).rejects.toThrow(EnvConfigError);
  });
});
