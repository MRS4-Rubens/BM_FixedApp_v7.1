import { createHash } from 'node:crypto';
import * as React from 'react';
import { inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { businesses, users } from '@/lib/db/schema';
import { getResend } from '@/lib/email/resend';
import { getAppEnv, getEmailEnv } from '@/lib/env';
import { NotificationEmail, type NotificationEmailItem } from '@/lib/email/templates/notification-email';
import { logError } from '@/lib/actions/_shared/logger';
import { toLoggableError } from '@/lib/actions/_shared/action-error-mapping';
import { isNotificationCategory } from './guards';
import { NOTIFICATION_SETTINGS_LINK } from './messages';
import { resolveNotificationPrefs, wantsEmail } from './prefs';

/** Give up on an e-mail after this many tries (each try is counted when the row is claimed). */
const NOTIFICATION_EMAIL_MAX_ATTEMPTS = 3;
/** A claim older than this belongs to a crashed sender and may be taken again. */
const STALE_CLAIM_MINUTES = 15;
/** Never e-mail news older than this (a long outage should not flood people with stale reminders). */
const MAX_AGE_DAYS = 3;
/** The daily summary lists at most this many items; the rest are counted. */
const DIGEST_MAX_ITEMS = 20;
const CLAIM_BATCH = 500;

export interface OutgoingEmail {
  readonly to: string;
  readonly subject: string;
  readonly react: React.ReactElement;
  readonly idempotencyKey: string;
}

/** Returns true when the provider accepted the e-mail. Must not throw. */
export type EmailSender = (email: OutgoingEmail) => Promise<boolean>;

export interface DeliverySummary {
  readonly claimed: number;
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
  readonly emails: number;
}

interface ClaimedRow {
  readonly id: string;
  readonly businessId: string;
  readonly userId: string;
  readonly category: string;
  readonly title: string;
  readonly body: string;
  readonly link: string | null;
  readonly urgent: boolean;
  readonly attempts: number;
}

function asClaimedRow(value: unknown): ClaimedRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== 'string' ||
    typeof row.business_id !== 'string' ||
    typeof row.user_id !== 'string' ||
    typeof row.category !== 'string' ||
    typeof row.title !== 'string' ||
    typeof row.body !== 'string' ||
    typeof row.urgent !== 'boolean'
  ) {
    return null;
  }
  const attempts = typeof row.email_attempts === 'number' ? row.email_attempts : Number(row.email_attempts);
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id,
    category: row.category,
    title: row.title,
    body: row.body,
    link: typeof row.link === 'string' ? row.link : null,
    urgent: row.urgent,
    attempts: Number.isFinite(attempts) ? attempts : NOTIFICATION_EMAIL_MAX_ATTEMPTS,
  };
}

const defaultSender: EmailSender = async (email) => {
  try {
    const result = await getResend().emails.send(
      {
        from: getEmailEnv().RESEND_FROM_EMAIL,
        to: [email.to],
        subject: email.subject,
        react: email.react,
      },
      { idempotencyKey: email.idempotencyKey },
    );
    if (result.error) {
      logError('notification-email', toLoggableError(result.error), {});
      return false;
    }
    return true;
  } catch (error: unknown) {
    logError('notification-email', error, {});
    return false;
  }
};

function idempotencyKeyFor(ids: readonly string[]): string {
  const digest = createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 40);
  return `notif:${digest}`;
}

/**
 * Atomically takes ownership of e-mailable rows: pending ones, plus 'sending' ones whose claim went stale.
 * FOR UPDATE SKIP LOCKED means two senders running at once never take the same row.
 */
async function claimRows(onlyIds: readonly string[] | undefined): Promise<ClaimedRow[]> {
  const idFilter =
    onlyIds === undefined
      ? sql``
      : sql`AND n.urgent = true AND n.id IN (${sql.join(onlyIds.map((id) => sql`${id}::uuid`), sql`, `)})`;
  const result = await db.execute(sql`
    UPDATE notifications AS target
    SET email_state = 'sending', email_claimed_at = now(), email_attempts = target.email_attempts + 1
    WHERE target.id IN (
      SELECT n.id FROM notifications n
      WHERE (n.email_state = 'pending'
             OR (n.email_state = 'sending' AND n.email_claimed_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES}::int)))
        AND n.created_at > now() - make_interval(days => ${MAX_AGE_DAYS}::int)
        ${idFilter}
      ORDER BY n.created_at
      LIMIT ${CLAIM_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING target.id, target.business_id, target.user_id, target.category, target.title, target.body,
              target.link, target.urgent, target.email_attempts
  `);
  return result.rows.map(asClaimedRow).filter((row): row is ClaimedRow => row !== null);
}

async function markSent(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.execute(sql`
    UPDATE notifications SET email_state = 'sent', emailed_at = now(), email_claimed_at = NULL
    WHERE id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) AND email_state = 'sending'
  `);
}

async function markSkipped(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.execute(sql`
    UPDATE notifications SET email_state = 'skipped', email_claimed_at = NULL
    WHERE id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) AND email_state = 'sending'
  `);
}

/** A failed try goes back to 'pending' for the next run, or to 'failed' once the attempt limit is reached. */
async function markFailedTry(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.execute(sql`
    UPDATE notifications
    SET email_state = CASE WHEN email_attempts >= ${NOTIFICATION_EMAIL_MAX_ATTEMPTS}::int THEN 'failed' ELSE 'pending' END,
        email_claimed_at = NULL
    WHERE id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) AND email_state = 'sending'
  `);
}

/** Rows still waiting after MAX_AGE_DAYS are given up on, so the queue can never grow without limit. */
export async function expireStaleEmailQueue(): Promise<void> {
  await db.execute(sql`
    UPDATE notifications SET email_state = 'failed', email_claimed_at = NULL
    WHERE email_state IN ('pending', 'sending') AND created_at <= now() - make_interval(days => ${MAX_AGE_DAYS}::int)
  `);
}

function absoluteUrl(appUrl: string, link: string | null): string | null {
  if (link === null || !link.startsWith('/') || link.startsWith('//')) return null;
  return `${appUrl}${link}`;
}

/**
 * Feature C: send the e-mails for notifications that are waiting.
 * - `ids` given (right after an event): only those URGENT rows, one e-mail each.
 * - no `ids` (the daily job): every waiting row; urgent ones one e-mail each, the rest grouped into ONE daily
 *   summary per person per business.
 * Before sending, each person's CURRENT address, membership and choices are re-checked; anything no longer wanted
 * is marked 'skipped'. Never throws for a single bad e-mail.
 */
export async function deliverNotificationEmails(
  options: { readonly ids?: readonly string[]; readonly send?: EmailSender } = {},
): Promise<DeliverySummary> {
  if (options.ids !== undefined && options.ids.length === 0) {
    return { claimed: 0, sent: 0, skipped: 0, failed: 0, emails: 0 };
  }
  const send = options.send ?? defaultSender;
  const claimed = await claimRows(options.ids);
  if (claimed.length === 0) return { claimed: 0, sent: 0, skipped: 0, failed: 0, emails: 0 };

  const userIds = [...new Set(claimed.map((row) => row.userId))];
  const businessIds = [...new Set(claimed.map((row) => row.businessId))];
  const [people, firms] = await Promise.all([
    db
      .select({ id: users.id, email: users.email, businessId: users.business_id, prefs: users.notification_prefs })
      .from(users)
      .where(inArray(users.id, userIds)),
    db
      .select({ id: businesses.id, legal: businesses.legal_name, trade: businesses.trade_name })
      .from(businesses)
      .where(inArray(businesses.id, businessIds)),
  ]);
  const personById = new Map(people.map((person) => [person.id, person]));
  const firmName = new Map(firms.map((firm) => [firm.id, firm.trade || firm.legal]));

  let appUrl: string;
  try {
    appUrl = getAppEnv().NEXT_PUBLIC_APP_URL;
  } catch (error: unknown) {
    // No app URL configured: we cannot build links. Give the rows back untouched (as a failed try) and stop.
    logError('notification-email', error, { reason: 'app url' });
    await markFailedTry(claimed.map((row) => row.id));
    return { claimed: claimed.length, sent: 0, skipped: 0, failed: claimed.length, emails: 0 };
  }
  const settingsUrl = `${appUrl}${NOTIFICATION_SETTINGS_LINK}`;

  const skipped: string[] = [];
  const groups = new Map<string, { to: string; businessId: string; rows: ClaimedRow[]; urgent: boolean }>();
  for (const row of claimed) {
    const person = personById.get(row.userId);
    const stillMember = person !== undefined && person.businessId === row.businessId;
    const address = person?.email ?? '';
    const category = isNotificationCategory(row.category) ? row.category : null;
    if (!stillMember || !address.includes('@') || category === null) {
      skipped.push(row.id);
      continue;
    }
    // A person who switched this off (or the summary off) since the row was created is respected now.
    if (!wantsEmail(resolveNotificationPrefs(person.prefs), category, row.urgent)) {
      skipped.push(row.id);
      continue;
    }
    const key = row.urgent ? `urgent:${row.id}` : `digest:${row.userId}:${row.businessId}`;
    const group = groups.get(key) ?? { to: address, businessId: row.businessId, rows: [], urgent: row.urgent };
    group.rows.push(row);
    groups.set(key, group);
  }
  await markSkipped(skipped);

  let sent = 0;
  let failed = 0;
  let emails = 0;
  for (const group of groups.values()) {
    const businessName = firmName.get(group.businessId) ?? 'your business';
    const shown = group.rows.slice(0, DIGEST_MAX_ITEMS);
    const items: NotificationEmailItem[] = shown.map((row) => ({
      title: row.title,
      body: row.body,
      url: absoluteUrl(appUrl, row.link),
    }));
    const first = group.rows[0];
    const heading = group.urgent && first ? first.title : 'Your daily update';
    const subject = group.urgent && first
      ? `${first.title} — ${businessName}`
      : `${group.rows.length} ${group.rows.length === 1 ? 'thing needs' : 'things need'} your attention — ${businessName}`;
    const ids = group.rows.map((row) => row.id);
    const ok = await send({
      to: group.to,
      subject,
      idempotencyKey: idempotencyKeyFor(ids),
      react: React.createElement(NotificationEmail, {
        businessName,
        heading,
        items,
        moreCount: group.rows.length - shown.length,
        settingsUrl,
        appUrl: `${appUrl}/dashboard`,
      }),
    });
    emails += 1;
    if (ok) {
      await markSent(ids);
      sent += ids.length;
    } else {
      await markFailedTry(ids);
      failed += ids.length;
    }
  }

  return { claimed: claimed.length, sent, skipped: skipped.length, failed, emails };
}
