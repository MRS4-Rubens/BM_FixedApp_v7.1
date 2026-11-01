import { pgTable, text, varchar, timestamp, uuid, integer, bigint, date, unique, index, check, foreignKey } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { businesses } from './businesses';
import { invoices } from './invoices';
import { financialYears } from './financial_years';
import { users } from './users';
import { lifecycleStatusEnum } from './enums';
import { creditNoteLineItems } from './credit_note_line_items';
import { sellerSnapshotColumns } from './_seller_snapshot';
import { inList } from './_check-helpers';
import { RECORD_STATUSES, type RecordStatus } from '../domain-values';

export const creditNotes = pgTable('credit_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  business_id: uuid('business_id').notNull().references(() => businesses.id),
  original_invoice_id: uuid('original_invoice_id').notNull(),
  financial_year_id: uuid('financial_year_id').notNull().references(() => financialYears.id),
  credit_note_sequence: integer('credit_note_sequence'),
  credit_note_number: text('credit_note_number').notNull(),
  reason: text('reason').notNull(),
  lifecycle_status: lifecycleStatusEnum('lifecycle_status').notNull().default('draft'),
  issue_date: date('issue_date'),
  subtotal_paise: bigint('subtotal_paise', { mode: 'number' }).notNull().default(0),
  total_cgst_paise: bigint('total_cgst_paise', { mode: 'number' }).notNull().default(0),
  total_sgst_paise: bigint('total_sgst_paise', { mode: 'number' }).notNull().default(0),
  total_igst_paise: bigint('total_igst_paise', { mode: 'number' }).notNull().default(0),
  total_tax_paise: bigint('total_tax_paise', { mode: 'number' }).notNull().default(0),
  grand_total_paise: bigint('grand_total_paise', { mode: 'number' }).notNull().default(0),
  pdf_storage_key: text('pdf_storage_key'),
  finalized_at: timestamp('finalized_at', { withTimezone: true }),
  seller_gstin_snapshot: varchar('seller_gstin_snapshot', { length: 15 }),
  ...sellerSnapshotColumns(),

  // Anti-fraud & Statutory Audit Trail Lifecycle Fields (CGST Rule 53 / GSTR-1 Table 13 Compliant)
  status: text('status').$type<RecordStatus>().notNull().default('active'), // DB-004: CHECK credit_notes_status_valid
  voided_at: timestamp('voided_at', { withTimezone: true }),
  voided_by: uuid('voided_by').references(() => users.id),
  void_reason: text('void_reason'),
  void_notes: text('void_notes'),

  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  unique('credit_notes_business_id_financial_year_id_seq_unique').on(table.business_id, table.financial_year_id, table.credit_note_sequence),
  unique('credit_notes_business_id_credit_note_number_unique').on(table.business_id, table.credit_note_number),
  index('credit_notes_original_invoice_id_idx').on(table.original_invoice_id),
  index('credit_notes_business_id_idx').on(table.business_id),
  index('credit_notes_biz_lifecycle_status_date_idx').on(
    table.business_id,
    table.lifecycle_status,
    table.status,
    table.issue_date
  ),
  // DB-002: composite key target + tenant-safe link to the original invoice.
  unique('credit_notes_biz_id_uq').on(table.business_id, table.id),
  foreignKey({
    name: 'credit_notes_invoice_same_biz',
    columns: [table.business_id, table.original_invoice_id],
    foreignColumns: [invoices.business_id, invoices.id]
  }),
  // DB-001: money can never be negative.
  check('credit_notes_money_nonneg', sql`${table.subtotal_paise} >= 0 AND ${table.total_tax_paise} >= 0 AND ${table.grand_total_paise} >= 0`),
  // DB-003: JavaScript Number.MAX_SAFE_INTEGER safety check.
  check(
    'credit_notes_paise_js_safe',
    sql`${table.subtotal_paise} <= 9007199254740991 AND ${table.total_cgst_paise} <= 9007199254740991 AND ${table.total_sgst_paise} <= 9007199254740991 AND ${table.total_igst_paise} <= 9007199254740991 AND ${table.total_tax_paise} <= 9007199254740991 AND ${table.grand_total_paise} <= 9007199254740991`
  ),
  // DB-001: a finalized credit note must carry its number, finalization time and issue date.
  check('credit_notes_final_requires_number', sql`${table.lifecycle_status} = 'draft' OR (${table.credit_note_sequence} IS NOT NULL AND ${table.finalized_at} IS NOT NULL AND ${table.issue_date} IS NOT NULL)`),
  // COMP-001: a finalized credit note must freeze the seller snapshot (including GSTIN) and declare its source.
  check('credit_notes_final_requires_seller_snapshot', sql`${table.lifecycle_status} = 'draft' OR (${table.seller_name_snapshot} IS NOT NULL AND ${table.seller_address_snapshot} IS NOT NULL AND ${table.seller_state_code_snapshot} IS NOT NULL AND ${table.seller_snapshot_source} IS NOT NULL AND ${table.seller_gstin_snapshot} IS NOT NULL)`),
  check('credit_notes_seller_snapshot_source_valid', sql`${table.seller_snapshot_source} IS NULL OR ${table.seller_snapshot_source} IN ('captured_at_finalization', 'backfilled_from_profile')`),
  // DB-004: CHECK credit_notes_status_valid
  check('credit_notes_status_valid', inList(table.status, RECORD_STATUSES))
]);

export const creditNotesRelations = relations(creditNotes, ({ one, many }) => ({
  business: one(businesses, {
    fields: [creditNotes.business_id],
    references: [businesses.id]
  }),
  originalInvoice: one(invoices, {
    fields: [creditNotes.original_invoice_id],
    references: [invoices.id]
  }),
  financialYear: one(financialYears, {
    fields: [creditNotes.financial_year_id],
    references: [financialYears.id]
  }),
  voidedByUser: one(users, {
    fields: [creditNotes.voided_by],
    references: [users.id]
  }),
  lineItems: many(creditNoteLineItems)
}));
