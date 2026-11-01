import { pgTable, text, varchar, timestamp, uuid, integer, bigint, date, unique, index, check, foreignKey } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { businesses } from './businesses';
import { customers } from './customers';
import { financialYears } from './financial_years';
import { invoiceTypeEnum, lifecycleStatusEnum, paymentStatusEnum, archivalStatusEnum, gstRateTypeEnum } from './enums';
import { invoiceLineItems } from './invoice_line_items';
import { payments } from './payments';
import { creditNotes } from './credit_notes';
import { sellerSnapshotColumns } from './_seller_snapshot';

// COMP-001: The *_snapshot fields freeze both seller and buyer details at finalization, ensuring subsequent edits to business profile or customer record never alter the legal content of a finalized invoice.
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  business_id: uuid('business_id').notNull().references(() => businesses.id),
  customer_id: uuid('customer_id'),
  financial_year_id: uuid('financial_year_id').notNull().references(() => financialYears.id),
  invoice_sequence: integer('invoice_sequence'),
  invoice_number: text('invoice_number').notNull(),
  invoice_type: invoiceTypeEnum('invoice_type').notNull().default('tax_invoice'),
  lifecycle_status: lifecycleStatusEnum('lifecycle_status').notNull().default('draft'),
  payment_status: paymentStatusEnum('payment_status').notNull().default('unpaid'),
  invoice_date: date('invoice_date'),
  // Computed and locked in at finalization time from the business's payment_due_days setting at that moment — changing payment_due_days later never affects already-finalized invoices, consistent with the snapshot-immutability principle used throughout this app.
  due_date: date('due_date'),
  place_of_supply_state_code: varchar('place_of_supply_state_code', { length: 2 }),
  seller_gstin_snapshot: varchar('seller_gstin_snapshot', { length: 15 }),
  ...sellerSnapshotColumns(),
  billing_name_snapshot: text('billing_name_snapshot'),
  billing_gstin_snapshot: varchar('billing_gstin_snapshot', { length: 15 }),
  billing_address_snapshot: text('billing_address_snapshot'),
  subtotal_paise: bigint('subtotal_paise', { mode: 'number' }).notNull().default(0),
  total_cgst_paise: bigint('total_cgst_paise', { mode: 'number' }).notNull().default(0),
  total_sgst_paise: bigint('total_sgst_paise', { mode: 'number' }).notNull().default(0),
  total_igst_paise: bigint('total_igst_paise', { mode: 'number' }).notNull().default(0),
  total_tax_paise: bigint('total_tax_paise', { mode: 'number' }).notNull().default(0),
  grand_total_paise: bigint('grand_total_paise', { mode: 'number' }).notNull().default(0),
  notes: text('notes'),
  invoice_template: text('invoice_template').notNull().default('template_1'),
  // pdf_storage_key (existing, Phase 2) holds the iDrive e2 object key once archival_status is 'archived'. credit_notes will get equivalent fields when Phase 12 is built, following this same pattern.
  pdf_storage_key: text('pdf_storage_key'),
  archival_status: archivalStatusEnum('archival_status').notNull().default('pending'),
  archival_attempts: integer('archival_attempts').notNull().default(0),
  archived_at: timestamp('archived_at', { withTimezone: true }),
  emailed_at: timestamp('emailed_at', { withTimezone: true }),
  email_send_count: integer('email_send_count').notNull().default(0),
  finalized_at: timestamp('finalized_at', { withTimezone: true }),
  // Calculation mode locked for this specific invoice to preserve print layout history (inclusive vs exclusive)
  gst_rate_type: gstRateTypeEnum('gst_rate_type').notNull().default('exclusive'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  unique('invoices_business_id_financial_year_id_invoice_seq_unique').on(table.business_id, table.financial_year_id, table.invoice_sequence),
  unique('invoices_business_id_invoice_number_unique').on(table.business_id, table.invoice_number),
  index('invoices_customer_id_idx').on(table.customer_id),
  index('invoices_invoice_date_idx').on(table.invoice_date),
  index('invoices_lifecycle_status_idx').on(table.lifecycle_status),
  index('invoices_payment_status_idx').on(table.payment_status),
  index('invoices_archival_status_idx').on(table.archival_status),
  index('invoices_business_id_idx').on(table.business_id),
  index('invoices_biz_lifecycle_date_idx').on(
    table.business_id,
    table.lifecycle_status,
    table.invoice_date
  ),
  index('invoices_biz_created_at_idx').on(table.business_id, table.created_at),
  // DB-002: composite key target for payments/credit_notes + tenant-safe customer link.
  unique('invoices_biz_id_uq').on(table.business_id, table.id),
  foreignKey({
    name: 'invoices_customer_same_biz',
    columns: [table.business_id, table.customer_id],
    foreignColumns: [customers.business_id, customers.id]
  }),
  // DB-001: money can never be negative.
  check('invoices_money_nonneg', sql`${table.subtotal_paise} >= 0 AND ${table.total_tax_paise} >= 0 AND ${table.grand_total_paise} >= 0`),
  // DB-003: JavaScript Number.MAX_SAFE_INTEGER safety check.
  check(
    'invoices_paise_js_safe',
    sql`${table.subtotal_paise} <= 9007199254740991 AND ${table.total_cgst_paise} <= 9007199254740991 AND ${table.total_sgst_paise} <= 9007199254740991 AND ${table.total_igst_paise} <= 9007199254740991 AND ${table.total_tax_paise} <= 9007199254740991 AND ${table.grand_total_paise} <= 9007199254740991`
  ),
  // DB-001: a finalized invoice must carry its number, finalization time and date.
  check('invoices_final_requires_number', sql`${table.lifecycle_status} = 'draft' OR (${table.invoice_sequence} IS NOT NULL AND ${table.finalized_at} IS NOT NULL AND ${table.invoice_date} IS NOT NULL)`),
  // COMP-001: a finalized invoice must freeze the seller snapshot and declare its source.
  check('invoices_final_requires_seller_snapshot', sql`${table.lifecycle_status} = 'draft' OR (${table.seller_name_snapshot} IS NOT NULL AND ${table.seller_address_snapshot} IS NOT NULL AND ${table.seller_state_code_snapshot} IS NOT NULL AND ${table.seller_snapshot_source} IS NOT NULL)`),
  check('invoices_seller_snapshot_source_valid', sql`${table.seller_snapshot_source} IS NULL OR ${table.seller_snapshot_source} IN ('captured_at_finalization', 'backfilled_from_profile')`)
]);

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  business: one(businesses, {
    fields: [invoices.business_id],
    references: [businesses.id]
  }),
  customer: one(customers, {
    fields: [invoices.customer_id],
    references: [customers.id]
  }),
  financialYear: one(financialYears, {
    fields: [invoices.financial_year_id],
    references: [financialYears.id]
  }),
  lineItems: many(invoiceLineItems),
  payments: many(payments),
  creditNotes: many(creditNotes)
}));
