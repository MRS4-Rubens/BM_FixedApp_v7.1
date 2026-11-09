import type * as Sentry from '@sentry/nextjs';

export type MonitorConfig = NonNullable<Parameters<typeof Sentry.withMonitor>[2]>;

export const ARCHIVAL_CRON_MONITOR_SLUG = 'retry-invoice-archival';

export const ARCHIVAL_CRON_MONITOR_CONFIG: MonitorConfig = {
  schedule: { type: 'crontab', value: '0 20 * * *' },
  checkinMargin: 30,
  maxRuntime: 10,
  timezone: 'UTC',
};

