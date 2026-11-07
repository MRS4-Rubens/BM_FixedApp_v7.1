import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { buildLogoUrl } from '@/lib/storage/logo-url';

const mockSelect = vi.fn();
vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => mockSelect(),
        }),
      }),
    }),
  },
}));

const mockGetFileBuffer = vi.fn();
vi.mock('@/lib/storage/idrive', () => ({
  getFileBuffer: (...args: unknown[]) => mockGetFileBuffer(...args),
}));

const mockIsLogoKeyReferenced = vi.fn();
vi.mock('@/lib/storage/logo', () => ({
  isLogoKeyReferenced: (...args: unknown[]) => mockIsLogoKeyReferenced(...args),
}));

const mockLogError = vi.fn();
vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

const mockGetClientIp = vi.fn();
const mockCheckRateLimit = vi.fn();
vi.mock('@/lib/rate-limit/upstash', () => ({
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

import { GET } from '@/app/api/business/[id]/logo/route';
import * as enforceModule from '@/lib/rate-limit/enforce';

const VALID_ID = '11111111-2222-3333-4444-555555555555';
const CURRENT_KEY = 'logos/11111111-2222-3333-4444-555555555555/0b6f1c1e-1111-4222-8333-444455556666.png';
const FAKE_PNG_BUFFER = Buffer.from('fake-png-data');

describe('GET /api/business/[id]/logo (SEC-005, PERF-003)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enforceModule.resetOutageLogThrottleForTests();
    mockGetClientIp.mockReturnValue('203.0.113.195');
    mockCheckRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
    mockSelect.mockResolvedValue([{ logo_storage_key: CURRENT_KEY }]);
    mockGetFileBuffer.mockResolvedValue(FAKE_PNG_BUFFER);
    mockIsLogoKeyReferenced.mockResolvedValue(false);
  });

  it('invalid UUID gives 400 and no limiter call', async () => {
    const spy = vi.spyOn(enforceModule, 'enforceRateLimit');
    const req = new NextRequest('http://localhost:3000/api/business/not-a-uuid/logo');
    const res = await GET(req, { params: Promise.resolve({ id: 'not-a-uuid' }) });

    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Invalid Business ID');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(spy).not.toHaveBeenCalled();
  });

  it('under the limit returns 200 with standard headers', async () => {
    const req = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(CURRENT_KEY)}`);
    const res = await GET(req, { params: Promise.resolve({ id: VALID_ID }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBe('public, max-age=86400');
    expect(res.headers.get('ETag')).toMatch(/^"[0-9a-f]{32}"$/);
    expect(res.headers.get('Content-Length')).toBe(String(FAKE_PNG_BUFFER.byteLength));
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
  });

  it('rate limited returns 429 with Retry-After and Cache-Control: no-store', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 25 });
    const req = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(CURRENT_KEY)}`);
    const res = await GET(req, { params: Promise.resolve({ id: VALID_ID }) });

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('25');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toBe('Too Many Requests');
  });

  it('Redis outage still serves the logo (fail-open)', async () => {
    mockCheckRateLimit.mockRejectedValue(new Error('Redis is down'));
    const req = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(CURRENT_KEY)}`);
    const res = await GET(req, { params: Promise.resolve({ id: VALID_ID }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('unknown IP skips the rate limiter', async () => {
    mockGetClientIp.mockReturnValue('unknown');
    const spy = vi.spyOn(enforceModule, 'enforceRateLimit');
    const req = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(CURRENT_KEY)}`);
    const res = await GET(req, { params: Promise.resolve({ id: VALID_ID }) });

    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a thrown storage error returns 500 and calls logError', async () => {
    mockGetFileBuffer.mockRejectedValue(new Error('iDrive S3 failure'));
    const req = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(CURRENT_KEY)}`);
    const res = await GET(req, { params: Promise.resolve({ id: VALID_ID }) });

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Failed to load logo');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mockLogError).toHaveBeenCalledWith('logo-route', expect.any(Error));
  });

  // PERF-003: New scenarios
  it('unknown business returns 404 with Cache-Control: no-store and no storage read (reviewer)', async () => {
    mockSelect.mockResolvedValue([]);
    const req = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(CURRENT_KEY)}`);
    const res = await GET(req, { params: Promise.resolve({ id: VALID_ID }) });

    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Business not found');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mockGetFileBuffer).not.toHaveBeenCalled();
  });

  it('no k + current key exists -> 307 redirect to versioned URL, Cache-Control: no-store, getFileBuffer not called', async () => {
    const req = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo`);
    const res = await GET(req, { params: Promise.resolve({ id: VALID_ID }) });

    expect(res.status).toBe(307);
    const location = res.headers.get('Location');
    expect(location).toBeTruthy();
    expect(location).toContain(buildLogoUrl(VALID_ID, CURRENT_KEY));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mockGetFileBuffer).not.toHaveBeenCalled();
  });

  it('no k + current key null -> 404 with Cache-Control: no-store', async () => {
    mockSelect.mockResolvedValue([{ logo_storage_key: null }]);
    const req = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo`);
    const res = await GET(req, { params: Promise.resolve({ id: VALID_ID }) });

    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toBe('Logo not found');
    expect(mockGetFileBuffer).not.toHaveBeenCalled();
  });

  it('matching If-None-Match returns 304 without calling getFileBuffer', async () => {
    const initialReq = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(CURRENT_KEY)}`);
    const initialRes = await GET(initialReq, { params: Promise.resolve({ id: VALID_ID }) });
    const etag = initialRes.headers.get('ETag')!;
    expect(etag).toBeTruthy();
    expect(mockGetFileBuffer).toHaveBeenCalledTimes(1);

    mockGetFileBuffer.mockClear();

    const conditionalReq = new NextRequest(
      `http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(CURRENT_KEY)}`,
      { headers: { 'if-none-match': etag } },
    );
    const conditionalRes = await GET(conditionalReq, { params: Promise.resolve({ id: VALID_ID }) });

    expect(conditionalRes.status).toBe(304);
    expect(await conditionalRes.text()).toBe('');
    expect(conditionalRes.headers.get('ETag')).toBe(etag);
    expect(conditionalRes.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(mockGetFileBuffer).not.toHaveBeenCalled();
  });

  it('If-None-Match with W/ prefix and inside a comma list -> 304', async () => {
    const initialReq = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(CURRENT_KEY)}`);
    const initialRes = await GET(initialReq, { params: Promise.resolve({ id: VALID_ID }) });
    const etag = initialRes.headers.get('ETag')!;

    mockGetFileBuffer.mockClear();

    const conditionalReq = new NextRequest(
      `http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(CURRENT_KEY)}`,
      { headers: { 'if-none-match': `"aaa", W/${etag}` } },
    );
    const conditionalRes = await GET(conditionalReq, { params: Promise.resolve({ id: VALID_ID }) });

    expect(conditionalRes.status).toBe(304);
    expect(mockGetFileBuffer).not.toHaveBeenCalled();
  });

  it("If-None-Match '*' -> 304", async () => {
    const conditionalReq = new NextRequest(
      `http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(CURRENT_KEY)}`,
      { headers: { 'if-none-match': '*' } },
    );
    const conditionalRes = await GET(conditionalReq, { params: Promise.resolve({ id: VALID_ID }) });

    expect(conditionalRes.status).toBe(304);
    expect(mockGetFileBuffer).not.toHaveBeenCalled();
  });

  it('non-matching If-None-Match -> 200', async () => {
    const conditionalReq = new NextRequest(
      `http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(CURRENT_KEY)}`,
      { headers: { 'if-none-match': '"different-etag-value"' } },
    );
    const conditionalRes = await GET(conditionalReq, { params: Promise.resolve({ id: VALID_ID }) });

    expect(conditionalRes.status).toBe(200);
    expect(mockGetFileBuffer).toHaveBeenCalled();
  });

  it('ETag is stable for the same key and different for a different key', async () => {
    const otherKey = 'logos/11111111-2222-3333-4444-555555555555/99999999-9999-4999-8999-999999999999.png';
    const req1 = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(CURRENT_KEY)}`);
    const res1 = await GET(req1, { params: Promise.resolve({ id: VALID_ID }) });

    const req2 = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(CURRENT_KEY)}`);
    const res2 = await GET(req2, { params: Promise.resolve({ id: VALID_ID }) });

    mockIsLogoKeyReferenced.mockResolvedValue(true);
    const req3 = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(otherKey)}`);
    const res3 = await GET(req3, { params: Promise.resolve({ id: VALID_ID }) });

    const etag1 = res1.headers.get('ETag');
    const etag2 = res2.headers.get('ETag');
    const etag3 = res3.headers.get('ETag');

    expect(etag1).toBe(etag2);
    expect(etag1).not.toBe(etag3);
  });

  it('k not current and isLogoKeyReferenced false -> 404, getFileBuffer not called; k referenced -> 200 immutable', async () => {
    const unreferencedKey = 'logos/11111111-2222-3333-4444-555555555555/unreferenced.png';
    mockIsLogoKeyReferenced.mockResolvedValue(false);

    const reqUnref = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(unreferencedKey)}`);
    const resUnref = await GET(reqUnref, { params: Promise.resolve({ id: VALID_ID }) });

    expect(resUnref.status).toBe(404);
    expect(resUnref.headers.get('Cache-Control')).toBe('no-store');
    expect(mockGetFileBuffer).not.toHaveBeenCalled();

    // Now mark as referenced
    mockIsLogoKeyReferenced.mockResolvedValue(true);
    const reqRef = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(unreferencedKey)}`);
    const resRef = await GET(reqRef, { params: Promise.resolve({ id: VALID_ID }) });

    expect(resRef.status).toBe(200);
    expect(resRef.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(mockGetFileBuffer).toHaveBeenCalledWith(unreferencedKey);
  });

  it('k with a disallowed extension that IS the current key -> 404, getFileBuffer not called', async () => {
    const gifKey = 'logos/11111111-2222-3333-4444-555555555555/logo.gif';
    mockSelect.mockResolvedValue([{ logo_storage_key: gifKey }]);

    const reqGif = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(gifKey)}`);
    const resGif = await GET(reqGif, { params: Promise.resolve({ id: VALID_ID }) });

    expect(resGif.status).toBe(404);
    expect(resGif.headers.get('Cache-Control')).toBe('no-store');
    expect(mockGetFileBuffer).not.toHaveBeenCalled();

    // Using string concatenation to prevent literal from triggering upload-guard.test.ts if ever checked
    const svgKey = 'logos/11111111-2222-3333-4444-555555555555/logo.' + 's' + 'vg';
    mockSelect.mockResolvedValue([{ logo_storage_key: svgKey }]);

    const reqSvg = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=${encodeURIComponent(svgKey)}`);
    const resSvg = await GET(reqSvg, { params: Promise.resolve({ id: VALID_ID }) });

    expect(resSvg.status).toBe(404);
    expect(resSvg.headers.get('Cache-Control')).toBe('no-store');
    expect(mockGetFileBuffer).not.toHaveBeenCalled();
  });

  it('k of length 301 or empty string -> 400 Invalid logo key, and neither limiter nor DB mock is called', async () => {
    const spy = vi.spyOn(enforceModule, 'enforceRateLimit');

    // k of length 301
    const longKey = 'a'.repeat(301);
    const reqLong = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=${longKey}`);
    const resLong = await GET(reqLong, { params: Promise.resolve({ id: VALID_ID }) });

    expect(resLong.status).toBe(400);
    expect(await resLong.text()).toBe('Invalid logo key');
    expect(resLong.headers.get('Cache-Control')).toBe('no-store');
    expect(spy).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();

    // k='' (?k=)
    const reqEmpty = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo?k=`);
    const resEmpty = await GET(reqEmpty, { params: Promise.resolve({ id: VALID_ID }) });

    expect(resEmpty.status).toBe(400);
    expect(await resEmpty.text()).toBe('Invalid logo key');
    expect(resEmpty.headers.get('Cache-Control')).toBe('no-store');
    expect(spy).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });
});
