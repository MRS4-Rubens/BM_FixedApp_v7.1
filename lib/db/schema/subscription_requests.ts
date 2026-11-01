import { pgTable, text, timestamp, uuid, integer, index, check } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { businesses } from './businesses';
import { users } from './users';
import { inList } from './_check-helpers';
import {
  SUBSCRIPTION_PLANS,
  REQUEST_BILLING_CYCLES,
  REQUEST_PAYMENT_METHODS,
  REQUEST_STATUSES,
  type SubscriptionPlanValue,
  type RequestBillingCycle,
  type RequestPaymentMethod,
  type RequestStatus,
} from '../domain-values';

export const subscriptionRequests = pgTable('subscription_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  business_id: uuid('business_id').notNull().references(() => businesses.id),
  user_id: uuid('user_id').notNull().references(() => users.id),
  plan_name: text('plan_name').$type<SubscriptionPlanValue>().notNull(),
  billing_cycle: text('billing_cycle').$type<RequestBillingCycle>().notNull(),
  amount_paise: integer('amount_paise').notNull(),
  payment_method: text('payment_method').$type<RequestPaymentMethod>().notNull(),
  payment_reference: text('payment_reference').notNull().unique(), // UTR / Transaction ID
  screenshot_storage_key: text('screenshot_storage_key'), // S3 Storage key
  status: text('status').$type<RequestStatus>().notNull().default('pending'),
  reject_reason: text('reject_reason'),
  approved_at: timestamp('approved_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('subscription_requests_business_id_idx').on(table.business_id),
  index('subscription_requests_status_idx').on(table.status),
  // DB-004: CHECK constraints for state columns
  check('subscription_requests_plan_name_valid', inList(table.plan_name, SUBSCRIPTION_PLANS)),
  check('subscription_requests_billing_cycle_valid', inList(table.billing_cycle, REQUEST_BILLING_CYCLES)),
  check('subscription_requests_payment_method_valid', inList(table.payment_method, REQUEST_PAYMENT_METHODS)),
  check('subscription_requests_status_valid', inList(table.status, REQUEST_STATUSES)),
]);

export const subscriptionRequestsRelations = relations(subscriptionRequests, ({ one }) => ({
  business: one(businesses, {
    fields: [subscriptionRequests.business_id],
    references: [businesses.id],
  }),
  user: one(users, {
    fields: [subscriptionRequests.user_id],
    references: [users.id],
  }),
}));
