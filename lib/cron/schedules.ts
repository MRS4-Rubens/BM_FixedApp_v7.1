/**
 * LAUNCH-L2: the single source of truth for the scheduled jobs.
 * On Render they are triggered by cron-job.org (docs/LAUNCH_CHECKLIST.md 3.12) with
 * `Authorization: Bearer <CRON_SECRET>`; times are UTC. A unit test pins the archival Sentry monitor to this list.
 */
export const CRON_JOBS = {
  /** 20:00 UTC = 01:30 IST. Retries failed invoice / credit-note PDF archives. */
  retryInvoiceArchival: { path: '/api/cron/retry-invoice-archival', schedule: '0 20 * * *' },
  /** 03:30 UTC = 09:00 IST. Creates the day's notifications and sends the e-mails. */
  dailyNotifications: { path: '/api/cron/daily-notifications', schedule: '30 3 * * *' },
} as const;
