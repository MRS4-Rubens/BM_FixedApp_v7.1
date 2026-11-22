import { Buffer } from 'node:buffer';
import { getPdfEnv } from '@/lib/env';
import { scrubString } from '@/lib/observability/sentry-redaction';

/**
 * HTML → PDF through Cloudflare Browser Rendering ("Browser Run") REST API (switched from CustomJS, LAUNCH-L7).
 * Same headless Chrome engine as before; the archival HTML is self-contained (inlined CSS, embedded fonts/logo).
 *
 * Free plan (Workers Free): 10 browser-minutes per day and **1 REST request every 10 seconds**. Requests are therefore
 * queued one at a time in this process and spaced CLOUDFLARE_MIN_INTERVAL_MS apart, and a 429 is retried once after
 * the server's Retry-After. Anything still failing surfaces as PdfRenderError, and the archival sweep retries later
 * (up to ARCHIVAL_MAX_ATTEMPTS).
 */
const PDF_RENDER_TIMEOUT_MS = 25_000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const MAX_ERROR_TEXT_CHARS = 200;
export const CLOUDFLARE_MIN_INTERVAL_MS = 10_500;
const MAX_RETRY_AFTER_MS = 30_000;

export type PdfRenderFailureKind = 'timeout' | 'network' | 'http' | 'invalid_response' | 'invalid_input' | 'busy';

/**
 * SVC-04: at most this many renders may wait in (or run from) the queue. At 10.5 s each, 20 is ~3.5 minutes of work;
 * beyond that a render fails at once with kind 'busy' (callers give the attempt back and retry later) instead of
 * queueing without limit.
 */
export const MAX_QUEUED_RENDERS = 20;

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
  /** Test seam for the pacing / Retry-After waits. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Test seam: skip the process-wide queue (each test gets fresh pacing). */
  readonly unpaced?: boolean;
  /** SVC-04: called when this render's turn in the queue comes, right before the request (e.g. to renew a lease). */
  readonly onTurn?: () => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// One request at a time, spaced apart (free-plan REST limit). Module state = one queue per server process.
let queueTail: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
let queuedRenders = 0;

/** Number of renders waiting in or running from the queue (for tests and diagnostics). */
export function queuedRenderCount(): number {
  return queuedRenders;
}

function paced<T>(task: () => Promise<T>, sleep: (ms: number) => Promise<void>, onTurn?: () => Promise<void>): Promise<T> {
  if (queuedRenders >= MAX_QUEUED_RENDERS) {
    return Promise.reject(new PdfRenderError('busy', 'Too many PDFs are waiting to be rendered; this one will be retried later.'));
  }
  queuedRenders += 1;
  const run = async () => {
    const wait = lastRequestAt + CLOUDFLARE_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    if (onTurn) await onTurn();
    return task();
  };
  const result = queueTail.then(run, run).finally(() => {
    queuedRenders -= 1;
  });
  queueTail = result.catch(() => undefined);
  return result;
}

function retryAfterMs(response: Response): number {
  const raw = response.headers?.get?.('retry-after');
  const seconds = raw ? Number(raw) : NaN;
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : CLOUDFLARE_MIN_INTERVAL_MS;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

export async function renderHtmlToPdfBuffer(html: string, options: RenderOptions = {}): Promise<Buffer> {
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  if (htmlBytes > MAX_HTML_BYTES) {
    throw new PdfRenderError('invalid_input', `Archival HTML is too large (${htmlBytes} bytes).`);
  }

  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN } = getPdfEnv(); // EnvConfigError propagates (callers refund the attempt)
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(CLOUDFLARE_ACCOUNT_ID)}/browser-run/pdf`;
  const body = JSON.stringify({
    html,
    // The page's own CSS sets `@page { size: A4; margin: 0 }`; A4 is also the explicit fallback.
    pdfOptions: { format: 'a4', printBackground: true, preferCSSPageSize: true },
    gotoOptions: { waitUntil: 'load' },
  });

  const attempt = async (): Promise<Response> =>
    doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/pdf',
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      },
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? PDF_RENDER_TIMEOUT_MS),
    });

  const run = async (): Promise<Buffer> => {
    let response = await attempt();
    if (response.status === 429) {
      await sleep(retryAfterMs(response));
      lastRequestAt = Date.now();
      response = await attempt();
    }
    if (!response.ok) {
      // Never echo the token, even if the provider were to include request details.
      const rawText = (await response.text()).split(CLOUDFLARE_API_TOKEN).join('[redacted]').replace(/[\u0000-\u001f]+/g, ' ');
      const text = scrubString(rawText).slice(0, MAX_ERROR_TEXT_CHARS);
      throw new PdfRenderError('http', `PDF rendering failed (${response.status}): ${text}`, response.status);
    }
    return Buffer.from(await response.arrayBuffer()); // body read is covered by the same timeout signal
  };

  let bytes: Buffer;
  try {
    bytes = options.unpaced ? await run() : await paced(run, sleep, options.onTurn);
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
