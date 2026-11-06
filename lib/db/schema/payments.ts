import { pgTable, text, timestamp, uuid, bigint, date, index, check, foreignKey } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { businesses } from './businesses';
import { invoices } from './invoices';
import { users } from './users';
import { paymentMethodEnum } from './enums';
import { inList } from './_check-helpers';
import { RECORD_STATUSES, type RecordStatus } from '../domain-values';

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  business_id: uuid('business_id').notNull().references(() => businesses.id),
  invoice_id: uuid('invoice_id').notNull(),
  amount_paise: bigint('amount_paise', { mode: 'number' }).notNull(),
  payment_date: date('payment_date').notNull(),
  payment_method: paymentMethodEnum('payment_method').notNull(),
  reference_number: text('reference_number'),
  notes: text('notes'),
  
  // Anti-fraud & Audit Trail Lifecycle Fields
  status: text('status').$type<RecordStatus>().notNull().default('active'), // DB-004: CHECK payments_status_valid
  voided_at: timestamp('voided_at', { withTimezone: true }),
  voided_by: uuid('voided_by').references(() => users.id),
  void_reason: text('void_reason'),
  void_notes: text('void_notes'),

  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index('payments_invoice_id_idx').on(table.invoice_id),
  index('payments_business_id_idx').on(table.business_id),
  index('payments_payment_date_idx').on(table.payment_date),
  index('payments_invoice_status_idx').on(table.invoice_id, table.status),
  // DB-002: a payment can only point at an invoice of the SAME business.
  foreignKey({
    name: 'payments_invoice_same_biz',
    columns: [table.business_id, table.invoice_id],
    foreignColumns: [invoices.business_id, invoices.id]
  }),
  // DB-001: a payment must be a positive amount.
  check('payments_amount_positive', sql`${table.amount_paise} > 0`),
  // DB-003: JavaScript Number.MAX_SAFE_INTEGER safety check.
  check('payments_amount_js_safe', sql`${table.amount_paise} <= 9007199254740991`),
  // DB-004: CHECK payments_status_valid
  check('payments_status_valid', inList(table.status, RECORD_STATUSES))
]);

export const paymentsRelations = relations(payments, ({ one }) => ({
  business: one(businesses, {
    fields: [payments.business_id],
    references: [businesses.id]
  }),
  invoice: one(invoices, {
    fields: [payments.invoice_id],
    references: [invoices.id]
  }),
  voidedByUser: one(users, {
    fields: [payments.voided_by],
    references: [users.id]
  })
}));
