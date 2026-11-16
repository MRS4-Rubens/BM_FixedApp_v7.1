import { pgTable, text, uuid, timestamp, index, jsonb, check } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { businesses } from './businesses';
import { roleEnum } from './enums';
import { auditLog } from './audit_log';

// This table is an app-level profile, not the auth credentials table itself, since Neon Auth manages its own internal auth tables separately.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  auth_user_id: text('auth_user_id').notNull().unique(),
  email: text('email'),
  business_id: uuid('business_id').references(() => businesses.id), // nullable because a user can exist before completing business setup in Phase 5
  role: roleEnum('role').notNull().default('owner'),
  display_name: text('display_name'),
  // Feature C: this person's notification e-mail choices. Stored sparse ({} = all defaults); always read through
  // lib/notifications/prefs.ts resolveNotificationPrefs, which validates and fills defaults.
  notification_prefs: jsonb('notification_prefs').$type<Record<string, unknown>>().notNull().default({}),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index('users_business_id_idx').on(table.business_id),
  index('users_email_idx').on(table.email),
  check('users_notification_prefs_object', sql`jsonb_typeof(${table.notification_prefs}) = 'object'`)
]);

export const usersRelations = relations(users, ({ one, many }) => ({
  business: one(businesses, {
    fields: [users.business_id],
    references: [businesses.id]
  }),
  auditLog: many(auditLog)
}));
