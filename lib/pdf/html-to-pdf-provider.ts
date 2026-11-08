import { Buffer } from 'node:buffer';
import { getPdfEnv } from '@/lib/env';
import { scrubString } from '@/lib/observability/sentry-redaction';

export const PDF_RENDER_TIMEOUT_MS = 25_000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const MAX_ERROR_TEXT_CHARS = 200;

export type PdfRenderFailureKind = 'timeout' | 'network' | 'http' | 'invalid_response' | 'invalid_input';

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

export async function renderHtmlToPdfBuffer(html: string, options: RenderOptions = {}): Promise<Buffer> {
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  if (htmlBytes > MAX_HTML_BYTES) {
    throw new PdfRenderError('invalid_input', `Archival HTML is too large (${htmlBytes} bytes).`);
  }

  const { HTML_TO_PDF_API_KEY } = getPdfEnv(); // EnvConfigError propagates (callers refund the attempt)
  const doFetch = options.fetchImpl ?? fetch;
  let bytes: Buffer;
  try {
    const response = await doFetch('https://e.customjs.io/html2pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/pdf',
        'x-api-key': HTML_TO_PDF_API_KEY,
      },
      body: JSON.stringify({
        input: {
          html,
          config: { pdfWidthMm: 210, pdfHeightMm: 297 },
        },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? PDF_RENDER_TIMEOUT_MS),
    });
    if (!response.ok) {
      const rawText = (await response.text()).replace(/[\u0000-\u001f]+/g, ' ');
      const text = scrubString(rawText).slice(0, MAX_ERROR_TEXT_CHARS);
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
