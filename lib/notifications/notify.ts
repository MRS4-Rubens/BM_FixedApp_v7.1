import { and, eq, inArray } from 'drizzle-orm';
import type { DbTransaction } from '@/lib/db/client';
import { notifications, users } from '@/lib/db/schema';
import { logError } from '@/lib/actions/_shared/logger';
import { isAppRole, type AppRole } from '@/lib/auth/rbac';
import { CATEGORY_ROLES, NOTIFICATION_KIND_CATEGORY } from './catalog';
import type { NotificationDraft } from './messages';
import { resolveNotificationPrefs, wantsEmail } from './prefs';

type Executor = Pick<DbTransaction, 'select' | 'insert'>;

export interface NotifyInput {
  readonly businessId: string;
  readonly draft: NotificationDraft;
  /**
   * Send to exactly these people (they must still belong to the business). When omitted, everyone in the business
   * whose role may receive this category gets it (lib/notifications/catalog.ts CATEGORY_ROLES).
   */
  readonly recipientUserIds?: readonly string[];
  /** Narrow the category's roles further (e.g. only the owner can act on "set your GST filing frequency"). */
  readonly onlyRoles?: readonly AppRole[];
}

/**
 * Feature C: create one notification row per recipient. Idempotent: the (user, business, dedupe_key) unique
 * constraint makes a repeat a silent no-op, so a re-run job or a retried transaction never tells anyone twice.
 * Returns how many rows were created, and the ids of the URGENT rows waiting for an e-mail (to send right after commit).
 */
export interface NotifyResult {
  readonly created: number;
  readonly emailNowIds: string[];
}

const NOTHING: NotifyResult = { created: 0, emailNowIds: [] };

export async function notify(executor: Executor, input: NotifyInput): Promise<NotifyResult> {
  const { businessId, draft } = input;
  const category = NOTIFICATION_KIND_CATEGORY[draft.kind];
  if (input.recipientUserIds !== undefined && input.recipientUserIds.length === 0) return NOTHING;

  const members = await executor
    .select({ id: users.id, role: users.role, email: users.email, prefs: users.notification_prefs })
    .from(users)
    .where(
      input.recipientUserIds === undefined
        ? eq(users.business_id, businessId)
        : and(eq(users.business_id, businessId), inArray(users.id, [...input.recipientUserIds])),
    );

  const allowedRoles = CATEGORY_ROLES[category].filter(
    (role) => input.onlyRoles === undefined || input.onlyRoles.includes(role),
  );
  const recipients = members.filter(
    (member) => input.recipientUserIds !== undefined || (isAppRole(member.role) && allowedRoles.includes(member.role)),
  );
  if (recipients.length === 0) return NOTHING;

  const rows = recipients.map((member) => {
    const hasAddress = typeof member.email === 'string' && member.email.includes('@');
    const emailWanted = hasAddress && wantsEmail(resolveNotificationPrefs(member.prefs), category, draft.urgent);
    return {
      business_id: businessId,
      user_id: member.id,
      kind: draft.kind,
      category,
      title: draft.title,
      body: draft.body,
      link: draft.link,
      dedupe_key: draft.dedupeKey,
      urgent: draft.urgent,
      email_state: emailWanted ? ('pending' as const) : ('skipped' as const),
    };
  });

  const inserted = await executor
    .insert(notifications)
    .values(rows)
    .onConflictDoNothing({ target: [notifications.user_id, notifications.business_id, notifications.dedupe_key] })
    .returning({ id: notifications.id, urgent: notifications.urgent, email_state: notifications.email_state });

  return {
    created: inserted.length,
    emailNowIds: inserted.filter((row) => row.urgent && row.email_state === 'pending').map((row) => row.id),
  };
}

/**
 * For use INSIDE a business transaction (payment approval, team changes): runs `notify` in a SAVEPOINT so a
 * notification problem can never undo or block the real work. On failure it logs and returns [] (the event itself
 * still commits; the person simply is not notified, which is the safe direction).
 * Returns the ids to pass to scheduleNotificationEmails AFTER the transaction commits.
 */
export async function notifyInTransaction(tx: DbTransaction, input: NotifyInput): Promise<string[]> {
  try {
    const result = await tx.transaction((savepoint) => notify(savepoint, input));
    return result.emailNowIds;
  } catch (error: unknown) {
    logError('notify', error, { kind: input.draft.kind, businessId: input.businessId });
    return [];
  }
}
