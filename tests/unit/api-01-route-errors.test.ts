import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * API-01: the download / polling routes answer every error with JSON { error, code } and the right status; the export
 * rate limit fails CLOSED with 503 + Retry-After when Upstash is unreachable (it used to be a generic 500).
 */
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  checkRateLimit: vi.fn(),
  userRows: vi.fn(),
  businessRows: vi.fn(),
  getExportData: vi.fn(),
  getGstr1: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/auth/request-session', () => ({ getRequestSession: () => mocks.session() }));
vi.mock('@/lib/rate-limit/upstash', () => ({
  exportLimiter: {},
  checkRateLimit: (...args: unknown[]) => mocks.checkRateLimit(...args),
}));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: (...args: unknown[]) => mocks.logError(...args) }));
vi.mock('@/lib/subscriptions/entitlements', () => ({
  checkAccountNotSuspended: () => ({ allowed: true }),
  canExportStatutoryReport: () => ({ allowed: true }),
}));
vi.mock('@/lib/actions/reports/get-export-data', () => ({ getExportData: (...a: unknown[]) => mocks.getExportData(...a) }));
vi.mock('@/lib/actions/reports/get-gstr1-data', () => ({ getGstr1ExportData: (...a: unknown[]) => mocks.getGstr1(...a) }));
vi.mock('@/lib/actions/reports/get-itr-data', () => ({ getItrExportData: vi.fn() }));
vi.mock('@/lib/db/client', () => ({
  db: {
    // users lookup: `.where()` is awaited directly; businesses / users with `.limit(1)` go through limit().
    select: () => ({
      from: () => ({
        where: () => {
          const users = Promise.resolve().then(() => mocks.userRows());
          return Object.assign(users, { limit: () => Promise.resolve().then(() => mocks.businessRows()) });
        },
      }),
    }),
  },
}));

import { GET as reportsExport } from '@/app/api/reports/export/route';
import { GET as importTemplate } from '@/app/api/import/template/route';
import { GET as notifications } from '@/app/api/notifications/route';
import { resetOutageLogThrottleForTests } from '@/lib/rate-limit/enforce';

const EXPORT_URL =
  'http://localhost:3000/api/reports/export?type=sales_register&startDate=2026-11-01&endDate=2026-11-30&label=November-2026';

async function body(res: Response): Promise<{ error?: string; code?: string }> {
  expect(res.headers.get('content-type')).toContain('application/json');
  return (await res.json()) as { error?: string; code?: string };
}

describe('API-01: reports export route errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOutageLogThrottleForTests();
    mocks.session.mockResolvedValue({ data: { user: { id: 'auth_1' } } });
    mocks.userRows.mockReturnValue([{ id: 'user_1', business_id: 'biz_1', role: 'owner' }]);
    mocks.businessRows.mockReturnValue([{ id: 'biz_1' }]);
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  });

  it('401 JSON when signed out', async () => {
    mocks.session.mockResolvedValue(null);
    const res = await reportsExport(new NextRequest(EXPORT_URL));
    expect(res.status).toBe(401);
    expect(await body(res)).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('400 JSON when the user has no business', async () => {
    mocks.userRows.mockReturnValue([{ id: 'user_1', business_id: null, role: 'owner' }]);
    const res = await reportsExport(new NextRequest(EXPORT_URL));
    expect(res.status).toBe(400);
    expect(await body(res)).toMatchObject({ code: 'NO_BUSINESS_LINKED' });
  });

  it('429 with Retry-After when over the limit', async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });
    const res = await reportsExport(new NextRequest(EXPORT_URL));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(await body(res)).toMatchObject({ code: 'RATE_LIMITED' });
    expect(mocks.getExportData).not.toHaveBeenCalled();
  });

  it('503 with Retry-After (not 500) when Upstash is unreachable; nothing is exported', async () => {
    mocks.checkRateLimit.mockRejectedValue(new Error('upstash down'));
    const res = await reportsExport(new NextRequest(EXPORT_URL));
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(await body(res)).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(mocks.getExportData).not.toHaveBeenCalled();
  });

  it('400 JSON for bad parameters', async () => {
    const res = await reportsExport(new NextRequest(EXPORT_URL.replace('2026-11-30', '2026-02-30')));
    expect(res.status).toBe(400);
    expect(await body(res)).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it.each([
    ['VALIDATION_ERROR', 400],
    ['NO_BUSINESS_LINKED', 400],
    ['RATE_LIMITED', 429],
    ['INTERNAL_ERROR', 500],
  ])('an action failure %s becomes HTTP %i with the same code', async (code, status) => {
    mocks.getExportData.mockResolvedValue({ success: false, error: { code, message: `msg ${code}` } });
    const res = await reportsExport(new NextRequest(EXPORT_URL));
    expect(res.status).toBe(status);
    expect(await body(res)).toEqual({ error: `msg ${code}`, code });
  });

  it('an unexpected crash is a JSON 500 with the request id', async () => {
    mocks.userRows.mockImplementation(() => {
      throw new Error('db down');
    });
    const res = await reportsExport(new NextRequest(EXPORT_URL, { headers: { 'x-request-id': 'req-api01' } }));
    expect(res.status).toBe(500);
    expect(res.headers.get('x-request-id')).toBe('req-api01');
    expect(await body(res)).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(mocks.logError).toHaveBeenCalledWith('reports-export', expect.any(Error));
  });
});

describe('API-01: import template and notifications survive a session lookup failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('import template: 401 JSON when signed out, JSON 500 when the session lookup throws', async () => {
    mocks.session.mockResolvedValue(null);
    const signedOut = await importTemplate(new NextRequest('http://localhost:3000/api/import/template?kind=customers'));
    expect(signedOut.status).toBe(401);
    expect(await body(signedOut)).toMatchObject({ code: 'UNAUTHORIZED' });

    mocks.session.mockRejectedValue(new Error('auth down'));
    const crashed = await importTemplate(new NextRequest('http://localhost:3000/api/import/template?kind=customers'));
    expect(crashed.status).toBe(500);
    expect(await body(crashed)).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(mocks.logError).toHaveBeenCalledWith('import-template', expect.any(Error), { kind: 'customers' });
  });

  it('notifications: JSON 500 when the session lookup throws', async () => {
    mocks.session.mockRejectedValue(new Error('auth down'));
    const res = await notifications();
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ error: 'Could not load notifications.' });
  });
});
