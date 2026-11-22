import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SVC-04: the archival lease is renewed when a document's turn in the Cloudflare queue comes, and the queue never
 * grows past MAX_QUEUED_RENDERS (the extra render fails at once as 'busy' and is retried later).
 * Each test imports a fresh copy of the provider, so the module-level queue starts empty.
 */
vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...actual,
    getPdfEnv: () => ({ CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef', CLOUDFLARE_API_TOKEN: 'cf-test-token' }),
  };
});

const pdfResponse = () =>
  ({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => Buffer.from('%PDF-1.7 test') }) as unknown as Response;

async function freshProvider() {
  vi.resetModules();
  return import('@/lib/pdf/html-to-pdf-provider');
}

describe('SVC-04: render queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls onTurn after the pacing wait and right before the Cloudflare request', async () => {
    const { renderHtmlToPdfBuffer } = await freshProvider();
    const events: string[] = [];
    const sleep = async () => {
      events.push('wait');
    };
    const fetchImpl = (async () => {
      events.push('request');
      return pdfResponse();
    }) as unknown as typeof fetch;
    const onTurn = async () => {
      events.push('renew lease');
    };

    await renderHtmlToPdfBuffer('<p>1</p>', { fetchImpl, sleep, onTurn });
    await renderHtmlToPdfBuffer('<p>2</p>', { fetchImpl, sleep, onTurn });

    // First render: no wait needed. Second render: waits its 10.5 s turn, THEN renews, THEN requests.
    expect(events).toEqual(['renew lease', 'request', 'wait', 'renew lease', 'request']);
  });

  it('measures the 10.5 s spacing from the request itself, not from before a slow onTurn', async () => {
    const { renderHtmlToPdfBuffer, CLOUDFLARE_MIN_INTERVAL_MS } = await freshProvider();
    let clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
      clock += ms;
    };
    const fetchImpl = (async () => pdfResponse()) as unknown as typeof fetch;
    // The first render's onTurn takes 6 s; the request starts after it.
    await renderHtmlToPdfBuffer('<p>1</p>', { fetchImpl, sleep, onTurn: async () => { clock += 6_000; } });
    await renderHtmlToPdfBuffer('<p>2</p>', { fetchImpl, sleep, onTurn: async () => undefined });
    expect(waits).toEqual([CLOUDFLARE_MIN_INTERVAL_MS]); // a full 10.5 s after the FIRST REQUEST, not 4.5 s
    vi.restoreAllMocks();
  });

  it('rejects the 21st waiting render at once as busy, without calling Cloudflare', async () => {
    const { renderHtmlToPdfBuffer, MAX_QUEUED_RENDERS, queuedRenderCount, PdfRenderError } = await freshProvider();
    expect(MAX_QUEUED_RENDERS).toBe(20);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    const fetchImpl = (async () => {
      requests += 1;
      await gate; // the first request hangs, so everything else stays queued
      return pdfResponse();
    }) as unknown as typeof fetch;
    const sleep = async () => undefined;

    const queued = Array.from({ length: MAX_QUEUED_RENDERS }, (_, i) =>
      renderHtmlToPdfBuffer(`<p>${i}</p>`, { fetchImpl, sleep }),
    );
    expect(queuedRenderCount()).toBe(MAX_QUEUED_RENDERS);

    const extra = await renderHtmlToPdfBuffer('<p>extra</p>', { fetchImpl, sleep }).catch((error: unknown) => error);
    expect(extra).toBeInstanceOf(PdfRenderError);
    expect(extra).toMatchObject({ kind: 'busy' });

    release();
    await Promise.all(queued);
    expect(requests).toBe(MAX_QUEUED_RENDERS); // the rejected one never reached Cloudflare
    expect(queuedRenderCount()).toBe(0);

    // Room again: the next render goes through.
    await expect(renderHtmlToPdfBuffer('<p>after</p>', { fetchImpl, sleep })).resolves.toBeInstanceOf(Buffer);
    expect(queuedRenderCount()).toBe(0);
  });

  it('a failed render also frees its queue slot', async () => {
    const { renderHtmlToPdfBuffer, queuedRenderCount } = await freshProvider();
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(renderHtmlToPdfBuffer('<p>x</p>', { fetchImpl, sleep: async () => undefined })).rejects.toMatchObject({ kind: 'network' });
    expect(queuedRenderCount()).toBe(0);
  });
});
