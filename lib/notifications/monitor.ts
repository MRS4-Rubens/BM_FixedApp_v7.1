import type { MonitorConfig } from '@/lib/storage/archival-monitor';

/** Sentry cron monitor for the daily notifications job. The schedule MUST equal vercel.json (a unit test pins it). */
export const NOTIFICATIONS_CRON_MONITOR_SLUG = 'daily-notifications';

export const NOTIFICATIONS_CRON_MONITOR_CONFIG: MonitorConfig = {
  // 03:30 UTC = 09:00 IST
  schedule: { type: 'crontab', value: '30 3 * * *' },
  checkinMargin: 30,
  maxRuntime: 10,
  timezone: 'UTC',
};
