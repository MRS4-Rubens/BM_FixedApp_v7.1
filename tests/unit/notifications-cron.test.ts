import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { CRON_JOBS } from '@/lib/cron/schedules';

// LAUNCH-L2: `after()` is captured so each test can await the background job.
const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as Promise<unknown>[] }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => {
    afterTasks.push(task());
  },
}));

const mockRunDaily = vi.fn();
vi.mock('@/lib/notifications/daily', () => ({
  runDailyNotifications: () => mockRunDaily(),
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
  withMonitor: vi.fn(async (_slug: string, fn: () => Promise<unknown>) => fn()),
  captureMessage: vi.fn(),
}));

import { GET } from '@/app/api/cron/daily-notifications/route';

const URL = 'http://localhost:3000/api/cron/daily-notifications';

async function settleBackground(): Promise<void> {
  await Promise.all(afterTasks.splice(0));
}

describe('Feature C: daily notifications cron route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterTasks.length = 0;
  });

  it('runs at 09:00 IST: the schedule cron-job.org follows is 03:30 UTC', () => {
    expect(CRON_JOBS.dailyNotifications).toEqual({ path: '/api/cron/daily-notifications', schedule: '30 3 * * *' });
  });

  it('authorized: replies 202 at once, then runs the job in the background (no Sentry cron monitor)', async () => {
    mockGetCronEnv.mockReturnValue({ CRON_SECRET: 'test-cron-secret-12345' });
    mockRunDaily.mockResolvedValue({ businesses: 3, created: 5, businessErrors: 0, deleted: 0 });
    const res = await GET(new NextRequest(URL, { headers: { authorization: 'Bearer test-cron-secret-12345' } }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'accepted', job: 'notifications-cron' });
    await settleBackground();
    expect(mockRunDaily).toHaveBeenCalledTimes(1);
    expect(Sentry.withMonitor).not.toHaveBeenCalled();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('a wrong or missing secret is refused with 401 and the job never runs', async () => {
    mockGetCronEnv.mockReturnValue({ CRON_SECRET: 'test-cron-secret-12345' });
    expect((await GET(new NextRequest(URL, { headers: { authorization: 'Bearer nope' } }))).status).toBe(401);
    expect((await GET(new NextRequest(URL))).status).toBe(401);
    await settleBackground();
    expect(mockRunDaily).not.toHaveBeenCalled();
  });

  it('a missing CRON_SECRET fails closed with 500', async () => {
    const envError = new Error('CRON_SECRET is missing');
    envError.name = 'EnvConfigError';
    mockGetCronEnv.mockImplementation(() => {
      throw envError;
    });
    const res = await GET(new NextRequest(URL, { headers: { authorization: 'Bearer anything' } }));
    expect(res.status).toBe(500);
    await settleBackground();
    expect(mockRunDaily).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith('notifications-cron', envError, expect.objectContaining({ reason: expect.any(String) }));
  });

  it('a failing job still replied 202 and the failure is logged (never thrown)', async () => {
    mockGetCronEnv.mockReturnValue({ CRON_SECRET: 'test-cron-secret-12345' });
    const failure = new Error('db down');
    mockRunDaily.mockRejectedValue(failure);
    const res = await GET(new NextRequest(URL, { headers: { authorization: 'Bearer test-cron-secret-12345' } }));
    expect(res.status).toBe(202);
    await settleBackground();
    expect(mockLogError).toHaveBeenCalledWith('notifications-cron', failure);
  });
});
