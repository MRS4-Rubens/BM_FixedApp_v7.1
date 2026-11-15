import { pgTable, text, timestamp, uuid, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  // A deleted admin must not block deletion or leave a dangling pointer; the change itself stays in platform_settings_history.
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const platformSettingsRelations = relations(platformSettings, ({ one }) => ({
  updatedByUser: one(users, {
    fields: [platformSettings.updated_by],
    references: [users.id],
  }),
}));
