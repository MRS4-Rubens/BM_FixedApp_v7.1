import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import {
  ARCHIVAL_CRON_MONITOR_SLUG,
  ARCHIVAL_CRON_MONITOR_CONFIG,
} from '@/lib/storage/archival-monitor';

// Mock dependencies for cron route
const mockRunArchivalSweep = vi.fn();
vi.mock('@/lib/storage/archival-sweep', () => ({
  runArchivalSweep: () => mockRunArchivalSweep(),
}));

const mockGetCronEnv = vi.fn();
vi.mock('@/lib/env', () => ({
  getCronEnv: () => mockGetCronEnv(),
  isEnvConfigError: (err: unknown) => (err as Error)?.name === 'EnvConfigError',
}));

const mockLogError = vi.fn();
vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

vi.mock('@sentry/nextjs', () => ({
  withMonitor: vi.fn(async (_slug, fn) => {
    return await fn();
  }),
  captureMessage: vi.fn(),
}));

import { GET } from '@/app/api/cron/retry-invoice-archival/route';

describe('OPT-001: Cron monitoring (Sentry Crons)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('monitor schedule equals the schedule of the /api/cron/retry-invoice-archival entry in vercel.json', () => {
    const vercelJsonPath = path.resolve(process.cwd(), 'vercel.json');
    const vercelConfig = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf8'));
    const cronEntry = vercelConfig.crons.find(
      (c: { path: string; schedule: string }) => c.path === '/api/cron/retry-invoice-archival',
    );
    expect(cronEntry).toBeDefined();
    expect(ARCHIVAL_CRON_MONITOR_CONFIG.schedule).toEqual({
      type: 'crontab',
      value: cronEntry.schedule,
    });
    expect(ARCHIVAL_CRON_MONITOR_SLUG).toBe('retry-invoice-archival');
    expect(ARCHIVAL_CRON_MONITOR_CONFIG.timezone).toBe('UTC');
    expect(ARCHIVAL_CRON_MONITOR_CONFIG.checkinMargin).toBe(30);
    expect(ARCHIVAL_CRON_MONITOR_CONFIG.maxRuntime).toBe(10);
  });

  it('authorized request calls withMonitor with the slug and config, returning 200 with x-request-id', async () => {
    mockGetCronEnv.mockReturnValue({ CRON_SECRET: 'test-cron-secret-12345' });
    mockRunArchivalSweep.mockResolvedValue({
      claimed: 2,
      succeeded: 2,
      failed: 0,
      skipped: 0,
      exhaustedInvoices: 0,
      exhaustedCreditNotes: 0,
      staleInvoices: 0,
      staleCreditNotes: 0,
    });

    const req = new NextRequest('http://localhost:3000/api/cron/retry-invoice-archival', {
      headers: {
        authorization: 'Bearer test-cron-secret-12345',
        'x-request-id': 'cron-req-001',
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('cron-req-001');
    expect(Sentry.withMonitor).toHaveBeenCalledWith(
      ARCHIVAL_CRON_MONITOR_SLUG,
      expect.any(Function),
      ARCHIVAL_CRON_MONITOR_CONFIG,
    );
    const data = await res.json();
    expect(data.succeeded).toBe(2);
  });

  it('401 request with invalid authorization header never calls withMonitor', async () => {
    mockGetCronEnv.mockReturnValue({ CRON_SECRET: 'test-cron-secret-12345' });

    const req = new NextRequest('http://localhost:3000/api/cron/retry-invoice-archival', {
      headers: {
        authorization: 'Bearer wrong-secret',
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(401);
    expect(res.headers.get('x-request-id')).toBeDefined();
    expect(Sentry.withMonitor).not.toHaveBeenCalled();
    expect(mockRunArchivalSweep).not.toHaveBeenCalled();
  });

  it('request with misconfigured CRON_SECRET returns 500 and never calls withMonitor', async () => {
    const envError = new Error('CRON_SECRET is missing');
    envError.name = 'EnvConfigError';
    mockGetCronEnv.mockImplementation(() => {
      throw envError;
    });

    const req = new NextRequest('http://localhost:3000/api/cron/retry-invoice-archival');
    const res = await GET(req);
    expect(res.status).toBe(500);
    expect(res.headers.get('x-request-id')).toBeDefined();
    expect(Sentry.withMonitor).not.toHaveBeenCalled();
    expect(mockRunArchivalSweep).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(
      'archival-cron',
      envError,
      expect.objectContaining({ reason: expect.any(String) }),
    );
  });

  it('thrown sweep returns 500, logs error, and withMonitor observed the rejection', async () => {
    mockGetCronEnv.mockReturnValue({ CRON_SECRET: 'test-cron-secret-12345' });
    const sweepError = new Error('Neon database unreachable');
    mockRunArchivalSweep.mockRejectedValue(sweepError);

    const req = new NextRequest('http://localhost:3000/api/cron/retry-invoice-archival', {
      headers: {
        authorization: 'Bearer test-cron-secret-12345',
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(500);
    expect(res.headers.get('x-request-id')).toBeDefined();
    expect(Sentry.withMonitor).toHaveBeenCalledWith(
      ARCHIVAL_CRON_MONITOR_SLUG,
      expect.any(Function),
      ARCHIVAL_CRON_MONITOR_CONFIG,
    );
    expect(mockLogError).toHaveBeenCalledWith('archival-cron', sweepError);
  });
});

