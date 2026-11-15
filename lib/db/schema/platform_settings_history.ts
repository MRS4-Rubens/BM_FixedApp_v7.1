import { pgTable, text, timestamp, uuid, jsonb, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

export const platformSettingsHistory = pgTable(
  'platform_settings_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    old_value: jsonb('old_value'),
    new_value: jsonb('new_value').notNull(),
    changed_by: uuid('changed_by')
      .notNull()
      .references(() => users.id),
    changed_by_email: text('changed_by_email'),
    request_context: jsonb('request_context'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('platform_settings_history_key_created_at_idx').on(table.key, table.created_at.desc()),
  ]
);

export const platformSettingsHistoryRelations = relations(platformSettingsHistory, ({ one }) => ({
  changedByUser: one(users, {
    fields: [platformSettingsHistory.changed_by],
    references: [users.id],
  }),
}));
