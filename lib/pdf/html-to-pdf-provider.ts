import { Buffer } from 'node:buffer';
import { getPdfEnv } from '@/lib/env';
import { redactArchivalTokens } from '@/lib/security/archival-token';

export const PDF_RENDER_TIMEOUT_MS = 25_000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_ERROR_TEXT_CHARS = 200;

export type PdfRenderFailureKind = 'timeout' | 'network' | 'http' | 'invalid_response';

export class PdfRenderError extends Error {
  readonly kind: PdfRenderFailureKind;
  readonly status: number | null;
  constructor(kind: PdfRenderFailureKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'PdfRenderError';
    this.kind = kind;
    this.status = status;
  }
}

function isAbortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export interface RenderOptions {
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export async function renderUrlToPdfBuffer(url: string, options: RenderOptions = {}): Promise<Buffer> {
  const { HTML_TO_PDF_API_KEY } = getPdfEnv(); // EnvConfigError propagates (callers refund the attempt)
  const doFetch = options.fetchImpl ?? fetch;
  let bytes: Buffer;
  try {
    const response = await doFetch('https://e.customjs.io/html2pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': HTML_TO_PDF_API_KEY },
      body: JSON.stringify({ input: { url }, config: { pdfWidthMm: 210, pdfHeightMm: 297 } }),
      signal: AbortSignal.timeout(options.timeoutMs ?? PDF_RENDER_TIMEOUT_MS),
    });
    if (!response.ok) {
      const rawText = (await response.text()).replace(/[\u0000-\u001f]+/g, ' ');
      const text = redactArchivalTokens(rawText).slice(0, MAX_ERROR_TEXT_CHARS);
      throw new PdfRenderError('http', `PDF rendering failed (${response.status}): ${text}`, response.status);
    }
    bytes = Buffer.from(await response.arrayBuffer()); // body read is covered by the same timeout signal
  } catch (error: unknown) {
    if (error instanceof PdfRenderError) throw error;
    if (isAbortLike(error)) throw new PdfRenderError('timeout', 'PDF rendering timed out.');
    throw new PdfRenderError('network', 'PDF rendering request failed.');
  }
  if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new PdfRenderError('invalid_response', 'PDF vendor returned a response that is not a valid PDF.');
  }
  return bytes;
}
