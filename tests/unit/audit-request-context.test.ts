import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_AUDIT_REQUEST_CONTEXT } from '@/lib/audit/log';
import { getAuditRequestContext } from '@/lib/audit/request-context';

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}));

import { headers } from 'next/headers';

describe('audit request context unit tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts and sanitizes ip from x-forwarded-for and user-agent', async () => {
    const mockHeaders = new Map<string, string>([
      ['x-forwarded-for', '203.0.113.195, 198.51.100.1'],
      ['user-agent', 'Mozilla/5.0 TestBrowser/1.0'],
    ]);

    vi.mocked(headers).mockResolvedValueOnce({
      get: (name: string) => mockHeaders.get(name.toLowerCase()) ?? null,
    } as unknown as Awaited<ReturnType<typeof headers>>);

    const ctx = await getAuditRequestContext();
    expect(ctx.ip).toBe('203.0.113.195');
    expect(ctx.userAgent).toBe('Mozilla/5.0 TestBrowser/1.0');
  });

  it('falls back to x-real-ip when x-forwarded-for is missing', async () => {
    const mockHeaders = new Map<string, string>([
      ['x-real-ip', '198.51.100.42'],
      ['user-agent', 'CustomAgent/2.0'],
    ]);

    vi.mocked(headers).mockResolvedValueOnce({
      get: (name: string) => mockHeaders.get(name.toLowerCase()) ?? null,
    } as unknown as Awaited<ReturnType<typeof headers>>);

    const ctx = await getAuditRequestContext();
    expect(ctx.ip).toBe('198.51.100.42');
    expect(ctx.userAgent).toBe('CustomAgent/2.0');
  });

  it('returns NO_AUDIT_REQUEST_CONTEXT when headers() throws (outside request context)', async () => {
    vi.mocked(headers).mockRejectedValueOnce(new Error('Invariant: headers() called outside request'));

    const ctx = await getAuditRequestContext();
    expect(ctx).toEqual(NO_AUDIT_REQUEST_CONTEXT);
    expect(ctx.ip).toBeNull();
    expect(ctx.userAgent).toBeNull();
  });

  it('sanitizes invalid or malicious IP and strips control chars from user-agent', async () => {
    const mockHeaders = new Map<string, string>([
      ['x-forwarded-for', '<script>alert(1)</script>'],
      ['user-agent', 'BadAgent\x00\x1fHeader'],
    ]);

    vi.mocked(headers).mockResolvedValueOnce({
      get: (name: string) => mockHeaders.get(name.toLowerCase()) ?? null,
    } as unknown as Awaited<ReturnType<typeof headers>>);

    const ctx = await getAuditRequestContext();
    expect(ctx.ip).toBeNull();
    expect(ctx.userAgent).toBe('BadAgent  Header');
  });
});

