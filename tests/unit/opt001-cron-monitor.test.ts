import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import {
  ARCHIVAL_CRON_MONITOR_SLUG,
  ARCHIVAL_CRON_MONITOR_CONFIG,
} from '@/lib/storage/archival-monitor';
import { CRON_JOBS } from '@/lib/cron/schedules';

// LAUNCH-L2: `after()` is captured so each test can await the background sweep.
const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as Promise<unknown>[] }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => {
    afterTasks.push(task());
  },
}));

async function settleBackground(): Promise<void> {
  await Promise.all(afterTasks.splice(0));
}

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
    afterTasks.length = 0;
  });

  it('monitor schedule equals the schedule cron-job.org follows (lib/cron/schedules.ts)', () => {
    expect(CRON_JOBS.retryInvoiceArchival).toEqual({ path: '/api/cron/retry-invoice-archival', schedule: '0 20 * * *' });
    expect(ARCHIVAL_CRON_MONITOR_CONFIG.schedule).toEqual({
      type: 'crontab',
      value: CRON_JOBS.retryInvoiceArchival.schedule,
    });
    expect(ARCHIVAL_CRON_MONITOR_SLUG).toBe('retry-invoice-archival');
    expect(ARCHIVAL_CRON_MONITOR_CONFIG.timezone).toBe('UTC');
    expect(ARCHIVAL_CRON_MONITOR_CONFIG.checkinMargin).toBe(30);
    expect(ARCHIVAL_CRON_MONITOR_CONFIG.maxRuntime).toBe(10);
  });

  it('authorized request replies 202 with x-request-id, then runs the sweep inside withMonitor', async () => {
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
    expect(res.status).toBe(202);
    expect(res.headers.get('x-request-id')).toBe('cron-req-001');
    expect(await res.json()).toEqual({ status: 'accepted', job: 'archival-cron' });
    await settleBackground();
    expect(mockRunArchivalSweep).toHaveBeenCalledTimes(1);
    expect(Sentry.withMonitor).toHaveBeenCalledWith(
      ARCHIVAL_CRON_MONITOR_SLUG,
      expect.any(Function),
      ARCHIVAL_CRON_MONITOR_CONFIG,
    );
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

  it('thrown sweep: reply was already 202; the error is logged and withMonitor observed the rejection', async () => {
    mockGetCronEnv.mockReturnValue({ CRON_SECRET: 'test-cron-secret-12345' });
    const sweepError = new Error('Neon database unreachable');
    mockRunArchivalSweep.mockRejectedValue(sweepError);

    const req = new NextRequest('http://localhost:3000/api/cron/retry-invoice-archival', {
      headers: {
        authorization: 'Bearer test-cron-secret-12345',
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(202);
    await settleBackground();
    expect(res.headers.get('x-request-id')).toBeDefined();
    expect(Sentry.withMonitor).toHaveBeenCalledWith(
      ARCHIVAL_CRON_MONITOR_SLUG,
      expect.any(Function),
      ARCHIVAL_CRON_MONITOR_CONFIG,
    );
    expect(mockLogError).toHaveBeenCalledWith('archival-cron', sweepError);
  });
});

