import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

describe('GET /api/business/[id]/logo (SEC-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enforceModule.resetOutageLogThrottleForTests();
    mockGetClientIp.mockReturnValue('203.0.113.195');
    mockCheckRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
    mockSelect.mockResolvedValue([{ logo_storage_key: 'business/11111111-2222-3333-4444-555555555555/logo.png' }]);
    mockGetFileBuffer.mockResolvedValue(Buffer.from('fake-png-data'));
  });

  it('invalid UUID gives 400 and no limiter call', async () => {
    const spy = vi.spyOn(enforceModule, 'enforceRateLimit');
    const req = new NextRequest('http://localhost:3000/api/business/not-a-uuid/logo');
    const res = await GET(req, { params: Promise.resolve({ id: 'not-a-uuid' }) });

    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Invalid Business ID');
    expect(spy).not.toHaveBeenCalled();
  });

  it('under the limit returns 200 with standard headers', async () => {
    const req = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo`);
    const res = await GET(req, { params: Promise.resolve({ id: VALID_ID }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('rate limited returns 429 with Retry-After and Cache-Control: no-store', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 25 });
    const req = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo`);
    const res = await GET(req, { params: Promise.resolve({ id: VALID_ID }) });

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('25');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toBe('Too Many Requests');
  });

  it('Redis outage still serves the logo (fail-open)', async () => {
    mockCheckRateLimit.mockRejectedValue(new Error('Redis is down'));
    const req = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo`);
    const res = await GET(req, { params: Promise.resolve({ id: VALID_ID }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('unknown IP skips the rate limiter', async () => {
    mockGetClientIp.mockReturnValue('unknown');
    const spy = vi.spyOn(enforceModule, 'enforceRateLimit');
    const req = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo`);
    const res = await GET(req, { params: Promise.resolve({ id: VALID_ID }) });

    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a thrown storage error returns 500 and calls logError', async () => {
    mockGetFileBuffer.mockRejectedValue(new Error('iDrive S3 failure'));
    const req = new NextRequest(`http://localhost:3000/api/business/${VALID_ID}/logo`);
    const res = await GET(req, { params: Promise.resolve({ id: VALID_ID }) });

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Failed to load logo');
    expect(mockLogError).toHaveBeenCalledWith('logo-route', expect.any(Error));
  });
});

