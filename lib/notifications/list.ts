import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { notifications } from '@/lib/db/schema';
import type { NotificationCategory, NotificationKind } from '@/lib/db/domain-values';

const NOTIFICATION_LIST_LIMIT = 20;

export interface NotificationListItem {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly category: NotificationCategory;
  readonly title: string;
  readonly body: string;
  readonly link: string | null;
  readonly read: boolean;
  /** ISO timestamp */
  readonly createdAt: string;
}

export interface NotificationList {
  readonly items: NotificationListItem[];
  readonly unreadCount: number;
}

/**
 * Feature C: one person's newest notifications for their CURRENT business, plus the unread count for the bell.
 * Scoped to (userId, businessId), so nobody can ever read another person's items. Used by GET /api/notifications
 * (a plain route, not a server action: background polling must never queue in front of the user's own actions).
 */
export async function listNotificationsFor(userId: string, businessId: string): Promise<NotificationList> {
  const mine = and(eq(notifications.user_id, userId), eq(notifications.business_id, businessId));
  const [rows, [unread]] = await Promise.all([
    db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        category: notifications.category,
        title: notifications.title,
        body: notifications.body,
        link: notifications.link,
        readAt: notifications.read_at,
        createdAt: notifications.created_at,
      })
      .from(notifications)
      .where(mine)
      .orderBy(desc(notifications.created_at), desc(notifications.id))
      .limit(NOTIFICATION_LIST_LIMIT),
    db.select({ n: count() }).from(notifications).where(and(mine, isNull(notifications.read_at))),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      category: row.category,
      title: row.title,
      body: row.body,
      link: row.link,
      read: row.readAt !== null,
      createdAt: row.createdAt.toISOString(),
    })),
    unreadCount: Number(unread?.n ?? 0),
  };
}
