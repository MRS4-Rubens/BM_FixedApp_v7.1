import { pgTable, text, timestamp, uuid, integer, boolean, index, unique, check } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { businesses } from './businesses';
import { users } from './users';
import { inList } from './_check-helpers';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EMAIL_STATES,
  NOTIFICATION_KINDS,
  type NotificationCategory,
  type NotificationEmailState,
  type NotificationKind,
} from '../domain-values';

/**
 * Feature C: one row per RECIPIENT (so each person has their own read state and e-mail state).
 * `dedupe_key` makes every reminder idempotent: the daily job and event hooks can run twice and the
 * (user, business, dedupe_key) unique constraint guarantees the person is told once.
 * Rows are scoped to a business as well as a user, so someone who leaves a business stops seeing its items.
 */
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  business_id: uuid('business_id').notNull().references(() => businesses.id),
  user_id: uuid('user_id').notNull().references(() => users.id),
  kind: text('kind').$type<NotificationKind>().notNull(),
  category: text('category').$type<NotificationCategory>().notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  /** In-app path (always starts with a single "/"), or NULL. Never an external URL. */
  link: text('link'),
  dedupe_key: text('dedupe_key').notNull(),
  /** Urgent items are e-mailed straight away instead of waiting for the daily summary. */
  urgent: boolean('urgent').notNull().default(false),
  read_at: timestamp('read_at', { withTimezone: true }),
  email_state: text('email_state').$type<NotificationEmailState>().notNull().default('skipped'),
  email_attempts: integer('email_attempts').notNull().default(0),
  email_claimed_at: timestamp('email_claimed_at', { withTimezone: true }),
  emailed_at: timestamp('emailed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('notifications_user_business_dedupe_uq').on(table.user_id, table.business_id, table.dedupe_key),
  index('notifications_user_business_created_idx').on(table.user_id, table.business_id, table.created_at),
  index('notifications_unread_idx').on(table.user_id, table.business_id).where(sql`${table.read_at} IS NULL`),
  index('notifications_email_queue_idx').on(table.created_at).where(sql`${table.email_state} IN ('pending', 'sending')`),
  index('notifications_business_id_idx').on(table.business_id),
  check('notifications_kind_valid', inList(table.kind, NOTIFICATION_KINDS)),
  check('notifications_category_valid', inList(table.category, NOTIFICATION_CATEGORIES)),
  check('notifications_email_state_valid', inList(table.email_state, NOTIFICATION_EMAIL_STATES)),
  check('notifications_sent_has_time', sql`(${table.email_state} = 'sent') = (${table.emailed_at} IS NOT NULL)`),
  check('notifications_link_internal', sql`${table.link} IS NULL OR (${table.link} LIKE '/%' AND ${table.link} NOT LIKE '//%')`),
  check('notifications_text_lengths', sql`length(${table.title}) BETWEEN 1 AND 200 AND length(${table.body}) BETWEEN 1 AND 1000 AND length(${table.dedupe_key}) BETWEEN 1 AND 200`),
  check('notifications_email_attempts_nonneg', sql`${table.email_attempts} >= 0`),
]);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  business: one(businesses, { fields: [notifications.business_id], references: [businesses.id] }),
  user: one(users, { fields: [notifications.user_id], references: [users.id] }),
}));
