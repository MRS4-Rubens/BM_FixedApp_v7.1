import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import {
  NOTIFICATIONS_CRON_MONITOR_CONFIG,
  NOTIFICATIONS_CRON_MONITOR_SLUG,
} from '@/lib/notifications/monitor';

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

describe('Feature C: daily notifications cron route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs at 09:00 IST: the monitor schedule equals the vercel.json entry', () => {
    const vercelConfig = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf8'));
    const entry = vercelConfig.crons.find((c: { path: string }) => c.path === '/api/cron/daily-notifications');
    expect(entry).toBeDefined();
    expect(entry.schedule).toBe('30 3 * * *'); // 03:30 UTC = 09:00 IST
    expect(NOTIFICATIONS_CRON_MONITOR_CONFIG.schedule).toEqual({ type: 'crontab', value: entry.schedule });
    expect(NOTIFICATIONS_CRON_MONITOR_SLUG).toBe('daily-notifications');
  });

  it('authorized: runs the job inside the Sentry monitor and returns its summary', async () => {
    mockGetCronEnv.mockReturnValue({ CRON_SECRET: 'test-cron-secret-12345' });
    mockRunDaily.mockResolvedValue({ businesses: 3, created: 5, businessErrors: 0, deleted: 0 });
    const res = await GET(new NextRequest(URL, { headers: { authorization: 'Bearer test-cron-secret-12345' } }));
    expect(res.status).toBe(200);
    expect(Sentry.withMonitor).toHaveBeenCalledWith(
      NOTIFICATIONS_CRON_MONITOR_SLUG,
      expect.any(Function),
      NOTIFICATIONS_CRON_MONITOR_CONFIG,
    );
    expect((await res.json()).created).toBe(5);
  });

  it('a wrong or missing secret is refused with 401 and the job never runs', async () => {
    mockGetCronEnv.mockReturnValue({ CRON_SECRET: 'test-cron-secret-12345' });
    expect((await GET(new NextRequest(URL, { headers: { authorization: 'Bearer nope' } }))).status).toBe(401);
    expect((await GET(new NextRequest(URL))).status).toBe(401);
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
    expect(mockRunDaily).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith('notifications-cron', envError, expect.objectContaining({ reason: expect.any(String) }));
  });

  it('a failing job returns 500 and is logged', async () => {
    mockGetCronEnv.mockReturnValue({ CRON_SECRET: 'test-cron-secret-12345' });
    mockRunDaily.mockRejectedValue(new Error('db down'));
    const res = await GET(new NextRequest(URL, { headers: { authorization: 'Bearer test-cron-secret-12345' } }));
    expect(res.status).toBe(500);
    expect(mockLogError).toHaveBeenCalledWith('notifications-cron', expect.any(Error));
  });
});
