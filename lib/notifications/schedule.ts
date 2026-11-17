import { after } from 'next/server';
import { logError, logWarn } from '@/lib/actions/_shared/logger';
import { deliverNotificationEmails } from './deliver';

/**
 * Call ONLY after the transaction that created the notifications has committed. Never throws.
 * If the immediate send fails, the rows stay 'pending' and the next daily run sends them (up to 3 days later).
 * When there is no request to attach to (scripts, tests), `after` is unavailable: that is not an error, because
 * the daily job is the designed safety net, so it is only a warning.
 */
export function scheduleNotificationEmails(ids: readonly string[]): void {
  if (ids.length === 0) return;
  try {
    after(async () => {
      try {
        await deliverNotificationEmails({ ids });
      } catch (error: unknown) {
        logError('notification-email-schedule', error, { count: ids.length });
      }
    });
  } catch {
    logWarn('notification-email-schedule', 'No request scope for an immediate send; the daily run will send it.', {
      count: ids.length,
    });
  }
}
