import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  CLOUDFLARE_MIN_INTERVAL_MS,
  renderHtmlToPdfBuffer,
  PdfRenderError,
} from '@/lib/pdf/html-to-pdf-provider';
import { EnvConfigError } from '@/lib/env';

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
const TOKEN = 'cf-test-token-12345';

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...actual,
    getPdfEnv: vi.fn(() => ({ CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef', CLOUDFLARE_API_TOKEN: 'cf-test-token-12345' })),
  };
});

import { getPdfEnv } from '@/lib/env';

const pdfResponse = (body = '%PDF-1.7 sample pdf content') =>
  ({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => Buffer.from(body) }) as unknown as Response;

const unpaced = { unpaced: true } as const;

describe('renderHtmlToPdfBuffer (Cloudflare Browser Rendering)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts the HTML to the account PDF endpoint with a Bearer token and A4 options, returning the PDF', async () => {
    let capturedUrl = '';
    let capturedOptions: RequestInit | undefined;
    const fetchImpl: typeof fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedOptions = init;
      return pdfResponse();
    });

    const sampleHtml = '<html><body><h1>Invoice #1</h1></body></html>';
    const result = await renderHtmlToPdfBuffer(sampleHtml, { fetchImpl, timeoutMs: 5000, ...unpaced });

    expect(capturedUrl).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/browser-run/pdf`);
    expect(capturedOptions?.method).toBe('POST');
    const headers = capturedOptions?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Accept']).toBe('application/pdf');
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(capturedOptions?.body))).toEqual({
      html: sampleHtml,
      pdfOptions: { format: 'a4', printBackground: true, preferCSSPageSize: true },
      gotoOptions: { waitUntil: 'load' },
    });
    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString('latin1')).toContain('%PDF-1.7');
  });

  it('throws invalid_input when html exceeds 8 MB cap and does not call fetch', async () => {
    const fetchImpl = vi.fn();
    const largeHtml = 'a'.repeat(8 * 1024 * 1024 + 1);
    await expect(
      renderHtmlToPdfBuffer(largeHtml, { fetchImpl: fetchImpl as unknown as typeof fetch, ...unpaced }),
    ).rejects.toMatchObject({ name: 'PdfRenderError', kind: 'invalid_input' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('aborts and throws PdfRenderError with kind timeout when signal aborts', async () => {
    const fetchImpl: typeof fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'));
    await expect(renderHtmlToPdfBuffer('<html></html>', { fetchImpl, timeoutMs: 100, ...unpaced })).rejects.toMatchObject({
      name: 'PdfRenderError',
      kind: 'timeout',
    });
  });

  it('throws PdfRenderError http with the status, scrubbing PII and never echoing the token', async () => {
    const fetchImpl: typeof fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      headers: new Headers(),
      text: async () => `Bad Gateway: customer_email=test@example.com gstin=27AAPFU0939F1ZV auth=${TOKEN}`,
    } as unknown as Response);

    const err = await renderHtmlToPdfBuffer('<html></html>', { fetchImpl, ...unpaced }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfRenderError);
    if (err instanceof PdfRenderError) {
      expect(err.kind).toBe('http');
      expect(err.status).toBe(502);
      expect(err.message).not.toContain('test@example.com');
      expect(err.message).not.toContain('27AAPFU0939F1ZV');
      expect(err.message).not.toContain(TOKEN);
      expect(err.message).toContain('[redacted]');
    }
  });

  it('on 429 waits for Retry-After, retries once, and succeeds', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl: typeof fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ 'retry-after': '7' }), text: async () => 'slow down' } as unknown as Response)
      .mockResolvedValueOnce(pdfResponse());
    const result = await renderHtmlToPdfBuffer('<html></html>', { fetchImpl, sleep, ...unpaced });
    expect(sleep).toHaveBeenCalledWith(7000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.toString('latin1')).toContain('%PDF-');
  });

  it('a second 429 becomes an http error (the archival sweep retries later)', async () => {
    const tooMany = { ok: false, status: 429, headers: new Headers(), text: async () => 'slow down' } as unknown as Response;
    const fetchImpl: typeof fetch = vi.fn().mockResolvedValue(tooMany);
    await expect(
      renderHtmlToPdfBuffer('<html></html>', { fetchImpl, sleep: async () => undefined, ...unpaced }),
    ).rejects.toMatchObject({ kind: 'http', status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('queues requests one at a time, and each request STARTS at least 10.5 s after the previous one', async () => {
    // Fake clock (Date + setTimeout): the real pacing sleep is used, so the test fails if the wait were skipped.
    vi.useFakeTimers();
    try {
      const starts: number[] = [];
      let active = 0;
      let maxActive = 0;
      const fetchImpl: typeof fetch = vi.fn().mockImplementation(async () => {
        starts.push(Date.now());
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        return pdfResponse();
      });
      const all = Promise.all([
        renderHtmlToPdfBuffer('<a>1</a>', { fetchImpl }),
        renderHtmlToPdfBuffer('<a>2</a>', { fetchImpl }),
        renderHtmlToPdfBuffer('<a>3</a>', { fetchImpl }),
      ]);
      // Just before one interval has passed, at most one request may have started.
      await vi.advanceTimersByTimeAsync(CLOUDFLARE_MIN_INTERVAL_MS - 1);
      expect(starts.length).toBeLessThanOrEqual(1);
      await vi.advanceTimersByTimeAsync(3 * CLOUDFLARE_MIN_INTERVAL_MS);
      await all;
      expect(maxActive).toBe(1);
      expect(starts).toHaveLength(3);
      for (let k = 1; k < starts.length; k += 1) {
        expect(starts[k]! - starts[k - 1]!).toBeGreaterThanOrEqual(CLOUDFLARE_MIN_INTERVAL_MS);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws invalid_response when body is not a valid PDF (%PDF- header missing)', async () => {
    const fetchImpl: typeof fetch = vi.fn().mockResolvedValue(pdfResponse('<html><body>Hello</body></html>'));
    await expect(renderHtmlToPdfBuffer('<html></html>', { fetchImpl, ...unpaced })).rejects.toMatchObject({
      name: 'PdfRenderError',
      kind: 'invalid_response',
    });
  });

  it('throws invalid_response when body is empty', async () => {
    const fetchImpl: typeof fetch = vi.fn().mockResolvedValue(pdfResponse(''));
    await expect(renderHtmlToPdfBuffer('<html></html>', { fetchImpl, ...unpaced })).rejects.toMatchObject({
      name: 'PdfRenderError',
      kind: 'invalid_response',
    });
  });

  it('throws network error when fetch rejects with general error', async () => {
    const fetchImpl: typeof fetch = vi.fn().mockRejectedValue(new Error('connection refused'));
    await expect(renderHtmlToPdfBuffer('<html></html>', { fetchImpl, ...unpaced })).rejects.toMatchObject({
      name: 'PdfRenderError',
      kind: 'network',
    });
  });

  it('propagates EnvConfigError when getPdfEnv throws', async () => {
    vi.mocked(getPdfEnv).mockImplementationOnce(() => {
      throw new EnvConfigError([{ group: 'pdf', name: 'CLOUDFLARE_ACCOUNT_ID', message: 'is required' }]);
    });
    await expect(renderHtmlToPdfBuffer('<html></html>', unpaced)).rejects.toThrow(EnvConfigError);
  });
});
