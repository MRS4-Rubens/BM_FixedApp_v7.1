import { z } from 'zod';
import type { NotificationCategory } from '@/lib/db/domain-values';

/** Feature C: one person's e-mail choices. In-app notifications are always on. CLIENT-SAFE. */
export interface NotificationPrefs {
  /** Per category: may this person get e-mails about it at all? */
  readonly email: Readonly<Record<NotificationCategory, boolean>>;
  /** Routine items: one summary e-mail each morning, or none. Urgent items ignore this (but respect `email`). */
  readonly digest: 'daily' | 'off';
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  email: { money: true, gst: true, account: true, team: true },
  digest: 'daily',
};

/** What the settings form sends. Strict: unknown keys are refused. */
export const notificationPrefsSchema = z
  .object({
    email: z
      .object({
        money: z.boolean(),
        gst: z.boolean(),
        account: z.boolean(),
        team: z.boolean(),
      })
      .strict(),
    digest: z.enum(['daily', 'off']),
  })
  .strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the stored JSON tolerantly: anything missing or malformed falls back to the default for that field,
 * so an old or hand-edited row can never break sending or the settings screen.
 */
export function resolveNotificationPrefs(raw: unknown): NotificationPrefs {
  const stored = isRecord(raw) ? raw : {};
  const storedEmail = isRecord(stored.email) ? stored.email : {};
  const pick = (category: NotificationCategory): boolean => {
    const value = storedEmail[category];
    return typeof value === 'boolean' ? value : DEFAULT_NOTIFICATION_PREFS.email[category];
  };
  const email: Record<NotificationCategory, boolean> = {
    money: pick('money'),
    gst: pick('gst'),
    account: pick('account'),
    team: pick('team'),
  };
  const digest = stored.digest === 'off' || stored.digest === 'daily' ? stored.digest : DEFAULT_NOTIFICATION_PREFS.digest;
  return { email, digest };
}

/** Should this person get an e-mail for an item of this category? */
export function wantsEmail(prefs: NotificationPrefs, category: NotificationCategory, urgent: boolean): boolean {
  if (!prefs.email[category]) return false;
  return urgent || prefs.digest === 'daily';
}
