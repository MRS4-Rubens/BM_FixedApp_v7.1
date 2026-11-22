import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetRequestSession = vi.fn();
vi.mock('@/lib/auth/request-session', () => ({
  getRequestSession: () => mockGetRequestSession(),
}));

const mockCheckRateLimit = vi.fn();
vi.mock('@/lib/rate-limit/upstash', () => ({
  exportLimiter: {},
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockWriteAudit = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  sanitizeIp: (ip: string | null) => ip || '127.0.0.1',
  sanitizeUserAgent: (ua: string | null) => ua || 'test-agent',
}));

const mockLoadDataExport = vi.fn();
const mockFailMidway = vi.fn(() => false);
// API-02: the route streams the export. The mock turns the data mockLoadDataExport resolves to into a JSON text stream
// of two chunks (like the real pages), generated lazily on the route's first read; mockFailMidway breaks chunk two.
vi.mock('@/lib/account/data-export', () => ({
  DATA_EXPORT_VERSION: 1,
  streamDataExport: (...args: unknown[]) =>
    (async function* stream() {
      const text = JSON.stringify(await mockLoadDataExport(...args));
      yield text.slice(0, 20);
      if (mockFailMidway()) throw new Error('db down midway');
      yield text.slice(20);
    })(),
}));

const mockLogError = vi.fn();
vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

// Mock DB chain
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return {
        from: (...fromArgs: unknown[]) => {
          mockFrom(...fromArgs);
          return {
            where: (...whereArgs: unknown[]) => {
              mockWhere(...whereArgs);
              return {
                limit: (...limitArgs: unknown[]) => mockLimit(...limitArgs),
              };
            },
          };
        },
      };
    },
    transaction: (cb: (tx: unknown) => Promise<unknown>) => mockTransaction(cb),
  },
}));

import { GET } from '@/app/api/account/export/route';

describe('OPT-002a: GET /api/account/export Route Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  });

  it('returns 401 when unauthenticated (no session)', async () => {
    mockGetRequestSession.mockResolvedValue(null);

    const req = new NextRequest('http://localhost:3000/api/account/export', {
      headers: { 'x-request-id': 'req-unauth-1' },
    });

    const res = await GET(req);
    expect(res.status).toBe(401);
    expect(res.headers.get('x-request-id')).toBe('req-unauth-1');

    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 when session user has no database user row', async () => {
    mockGetRequestSession.mockResolvedValue({
      data: { user: { id: 'auth_ghost' } },
    });
    mockLimit.mockResolvedValueOnce([]); // No user row

    const req = new NextRequest('http://localhost:3000/api/account/export');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 when user has staff role (owner-only access)', async () => {
    mockGetRequestSession.mockResolvedValue({
      data: { user: { id: 'auth_staff' } },
    });
    mockLimit
      .mockResolvedValueOnce([
        {
          id: 'user_staff_1',
          auth_user_id: 'auth_staff',
          business_id: 'biz_123',
          role: 'staff',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'biz_123',
          subscription_status: 'active',
        },
      ]);

    const req = new NextRequest('http://localhost:3000/api/account/export');
    const res = await GET(req);
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toBe('Only the business owner can download the account data.');
    expect(mockLoadDataExport).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it('returns 429 when export rate limit is exceeded', async () => {
    mockGetRequestSession.mockResolvedValue({
      data: { user: { id: 'auth_owner' } },
    });
    mockLimit
      .mockResolvedValueOnce([
        {
          id: 'user_owner_1',
          auth_user_id: 'auth_owner',
          business_id: 'biz_123',
          role: 'owner',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'biz_123',
          subscription_status: 'active',
        },
      ]);

    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 30,
    });

    const req = new NextRequest('http://localhost:3000/api/account/export');
    const res = await GET(req);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');

    const body = await res.json();
    expect(body.error).toContain('Too Many Requests. Retry after 30 seconds.');
    expect(mockLoadDataExport).not.toHaveBeenCalled();
  });

  it('API-01: returns 503 with Retry-After (not 500) when the rate limiter is unreachable', async () => {
    mockGetRequestSession.mockResolvedValue({ data: { user: { id: 'auth_owner' } } });
    mockLimit
      .mockResolvedValueOnce([{ id: 'user_owner_1', auth_user_id: 'auth_owner', business_id: 'biz_123', role: 'owner' }])
      .mockResolvedValueOnce([{ id: 'biz_123', subscription_status: 'active' }]);
    mockCheckRateLimit.mockRejectedValueOnce(new Error('upstash down'));

    const res = await GET(new NextRequest('http://localhost:3000/api/account/export'));
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect((await res.json()).code).toBe('SERVICE_UNAVAILABLE');
    expect(mockLoadDataExport).not.toHaveBeenCalled();
  });

  it('returns 200 with JSON attachment and logs audit record for owner', async () => {
    mockGetRequestSession.mockResolvedValue({
      data: { user: { id: 'auth_owner' } },
    });
    mockLimit
      .mockResolvedValueOnce([
        {
          id: 'user_owner_1',
          auth_user_id: 'auth_owner',
          business_id: 'biz_123',
          role: 'owner',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'biz_123',
          subscription_status: 'active',
        },
      ]);

    const fakeExportData = {
      format: 'bill-matrix-data-export',
      version: 1,
      exported_at: '2026-04-01T12:00:00.000Z',
      business: { id: 'biz_123', legal_name: 'Acme Test' },
      users: [],
      customers: [],
      products: [],
      financial_years: [],
      invoices: [],
      credit_notes: [],
      payments: [],
      subscription_requests: [],
    };
    mockLoadDataExport.mockResolvedValueOnce(fakeExportData);

    const req = new NextRequest('http://localhost:3000/api/account/export', {
      headers: {
        'x-request-id': 'export-req-123',
        'x-forwarded-for': '203.0.113.195',
        'user-agent': 'Mozilla/5.0 TestBrowser',
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('x-request-id')).toBe('export-req-123');

    const disposition = res.headers.get('Content-Disposition');
    expect(disposition).toMatch(/^attachment; filename="bill-matrix-data-\d{4}-\d{2}-\d{2}\.json"$/);

    const body = await res.json();
    expect(body).toEqual(fakeExportData);

    // Verify audit log write
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        businessId: 'biz_123',
        actorUserId: 'user_owner_1',
        entityType: 'business',
        entityId: 'biz_123',
        action: 'data_export',
        metadata: { version: 1 },
      }),
    );
  });

  it('allows data export for expired or suspended businesses (unconditional DPDP right of access)', async () => {
    mockGetRequestSession.mockResolvedValue({
      data: { user: { id: 'auth_owner' } },
    });
    mockLimit
      .mockResolvedValueOnce([
        {
          id: 'user_owner_1',
          auth_user_id: 'auth_owner',
          business_id: 'biz_suspended_999',
          role: 'owner',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'biz_suspended_999',
          subscription_status: 'expired', // Suspended/expired
        },
      ]);

    const fakeExportData = {
      format: 'bill-matrix-data-export',
      version: 1,
      exported_at: '2026-04-01T12:00:00.000Z',
      business: { id: 'biz_suspended_999', legal_name: 'Suspended Corp' },
      users: [],
      customers: [],
      products: [],
      financial_years: [],
      invoices: [],
      credit_notes: [],
      payments: [],
      subscription_requests: [],
    };
    mockLoadDataExport.mockResolvedValueOnce(fakeExportData);

    const req = new NextRequest('http://localhost:3000/api/account/export');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.business.id).toBe('biz_suspended_999');
  });

  it('handles unexpected errors gracefully with 500 status and logging', async () => {
    mockGetRequestSession.mockRejectedValue(new Error('Fatal database connection error'));

    const req = new NextRequest('http://localhost:3000/api/account/export', {
      headers: { 'x-request-id': 'err-req-500' },
    });
    const res = await GET(req);

    expect(res.status).toBe(500);
    expect(res.headers.get('x-request-id')).toBe('err-req-500');
    expect(mockLogError).toHaveBeenCalledWith(
      'account-data-export',
      expect.any(Error),
    );
  });

  it('API-02: a failure before the first chunk is a clean JSON 500; a failure mid-download errors the stream and is logged', async () => {
    const asOwner = () => {
      mockGetRequestSession.mockResolvedValue({ data: { user: { id: 'auth_owner' } } });
      mockLimit
        .mockResolvedValueOnce([{ id: 'user_owner_1', auth_user_id: 'auth_owner', business_id: 'biz_123', role: 'owner' }])
        .mockResolvedValueOnce([{ id: 'biz_123', subscription_status: 'active' }]);
    };

    asOwner();
    mockLoadDataExport.mockRejectedValueOnce(new Error('db down at start'));
    const early = await GET(new NextRequest('http://localhost:3000/api/account/export'));
    expect(early.status).toBe(500);
    expect((await early.json()).code).toBe('INTERNAL_ERROR');
    expect(mockWriteAudit).not.toHaveBeenCalled(); // nothing was exported

    asOwner();
    mockLoadDataExport.mockResolvedValueOnce({ format: 'bill-matrix-data-export', invoices: [] });
    mockFailMidway.mockReturnValueOnce(true);
    const midway = await GET(new NextRequest('http://localhost:3000/api/account/export'));
    expect(midway.status).toBe(200); // headers were already sent
    await expect(midway.text()).rejects.toThrow(); // the download fails instead of ending as a cut-off "complete" file
    expect(mockLogError).toHaveBeenCalledWith('account-data-export-stream', expect.any(Error), { businessId: 'biz_123' });
  });
});

