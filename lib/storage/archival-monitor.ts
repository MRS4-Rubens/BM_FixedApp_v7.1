import type * as Sentry from '@sentry/nextjs';
import { CRON_JOBS } from '@/lib/cron/schedules';

export type MonitorConfig = NonNullable<Parameters<typeof Sentry.withMonitor>[2]>;

export const ARCHIVAL_CRON_MONITOR_SLUG = 'retry-invoice-archival';

export const ARCHIVAL_CRON_MONITOR_CONFIG: MonitorConfig = {
  schedule: { type: 'crontab', value: CRON_JOBS.retryInvoiceArchival.schedule },
  checkinMargin: 30,
  maxRuntime: 10,
  timezone: 'UTC',
};

