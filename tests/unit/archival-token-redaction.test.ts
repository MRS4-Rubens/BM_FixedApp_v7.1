import { describe, expect, it, vi } from 'vitest';
import { redactArchivalTokens, createArchivalToken } from '@/lib/security/archival-token';
import { renderUrlToPdfBuffer, PdfRenderError } from '@/lib/pdf/html-to-pdf-provider';

const TEST_SECRET = '0123456789abcdef0123456789abcdef';

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...actual,
    getArchivalEnv: vi.fn(() => ({
      ARCHIVAL_SIGNING_SECRET: TEST_SECRET,
    })),
    getPdfEnv: vi.fn(() => ({
      HTML_TO_PDF_API_KEY: 'mock-pdf-api-key',
    })),
  };
});

describe('Archival Token Redaction (SEC-004)', () => {
  const validUuid = '12345678-1234-4234-8234-1234567890ab';

  it('redacts ?token=... from URLs while leaving other parameters untouched', () => {
    const token = createArchivalToken('invoice', validUuid);
    const input = `https://example.com/api/invoices/${validUuid}/archival-render?token=${token}&format=pdf&zoom=1`;
    const redacted = redactArchivalTokens(input);

    expect(redacted).not.toContain(token);
    expect(redacted).toContain('?token=[redacted]&format=pdf&zoom=1');
  });

  it('redacts &token=... from URLs', () => {
    const token = createArchivalToken('credit_note', validUuid);
    const input = `https://example.com/render?preview=true&token=${token}`;
    const redacted = redactArchivalTokens(input);

    expect(redacted).not.toContain(token);
    expect(redacted).toContain('&token=[redacted]');
  });

  it('redacts bare standalone token shapes from arbitrary text', () => {
    const invToken = createArchivalToken('invoice', validUuid);
    const cnToken = createArchivalToken('credit_note', validUuid);
    const text = `Renderer failed on ${invToken} and also logged ${cnToken} in error trace.`;
    const redacted = redactArchivalTokens(text);

    expect(redacted).not.toContain(invToken);
    expect(redacted).not.toContain(cnToken);
    expect(redacted).toBe('Renderer failed on [redacted-token] and also logged [redacted-token] in error trace.');
  });

  it('leaves other text and non-token query parameters untouched', () => {
    const text = 'Normal log without sensitive data: page=1&limit=50&user_id=123';
    expect(redactArchivalTokens(text)).toBe(text);
  });

  it('ensures provider thrown error contains no token when vendor echoes URL', async () => {
    const token = createArchivalToken('invoice', validUuid);
    const fullUrl = `https://app.billmatrix.dev/api/invoices/${validUuid}/archival-render?token=${token}`;

    const fetchImpl: typeof fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => `Failed to load URL: ${fullUrl} due to upstream 401`,
    } as unknown as Response);

    await expect(renderUrlToPdfBuffer(fullUrl, { fetchImpl })).rejects.toThrow(PdfRenderError);

    try {
      await renderUrlToPdfBuffer(fullUrl, { fetchImpl });
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(PdfRenderError);
      if (err instanceof PdfRenderError) {
        expect(err.message).not.toContain(token);
        expect(err.message).toContain('?token=[redacted]');
      }
    }
  });
});
