import { pgTable, text, timestamp, uuid, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { businesses } from './businesses';
import { users } from './users';
import { inList } from './_check-helpers';
import {
  INVITATION_STATUSES,
  INVITABLE_ROLES,
  type InvitationStatus,
  type InvitableRole,
} from '../domain-values';

/**
 * Team invitations (feature A). One row per invite; resending rotates the token on the same row.
 * Only a SHA-256 hash of the token is stored, so a database leak cannot be turned into working invite links.
 * `email` is stored lower-cased and trimmed (see lib/team/invite-token.ts normaliseInviteEmail).
 */
export const businessInvitations = pgTable('business_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  business_id: uuid('business_id').notNull().references(() => businesses.id),
  email: text('email').notNull(),
  role: text('role').$type<InvitableRole>().notNull().default('staff'),
  token_hash: text('token_hash').notNull().unique(),
  status: text('status').$type<InvitationStatus>().notNull().default('pending'),
  invited_by: uuid('invited_by').notNull().references(() => users.id),
  accepted_by: uuid('accepted_by').references(() => users.id),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  accepted_at: timestamp('accepted_at', { withTimezone: true }),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('business_invitations_business_id_idx').on(table.business_id),
  // At most one open invite per email per business (expired-but-pending rows are reused by a re-invite).
  uniqueIndex('business_invitations_one_pending_per_email')
    .on(table.business_id, table.email)
    .where(sql`${table.status} = 'pending'`),
  check('business_invitations_status_valid', inList(table.status, INVITATION_STATUSES)),
  check('business_invitations_role_valid', inList(table.role, INVITABLE_ROLES)),
  check('business_invitations_email_normalised', sql`${table.email} = lower(btrim(${table.email})) AND ${table.email} <> ''`),
  check(
    'business_invitations_accept_fields',
    sql`(${table.status} = 'accepted') = (${table.accepted_by} IS NOT NULL AND ${table.accepted_at} IS NOT NULL)`,
  ),
  check(
    'business_invitations_revoke_fields',
    sql`(${table.status} = 'revoked') = (${table.revoked_at} IS NOT NULL)`,
  ),
]);

export const businessInvitationsRelations = relations(businessInvitations, ({ one }) => ({
  business: one(businesses, {
    fields: [businessInvitations.business_id],
    references: [businesses.id],
  }),
  invitedByUser: one(users, {
    fields: [businessInvitations.invited_by],
    references: [users.id],
  }),
}));
