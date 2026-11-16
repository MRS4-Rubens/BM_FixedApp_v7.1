import { after } from 'next/server';
import { logError } from '@/lib/actions/_shared/logger';
import { deliverNotificationEmails } from './deliver';

/**
 * Call ONLY after the transaction that created the notifications has committed. Never throws.
 * If the immediate send fails or `after` is unavailable, the rows stay 'pending' and the next daily run sends them.
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
  } catch (error: unknown) {
    logError('notification-email-schedule', error, { count: ids.length });
  }
}
