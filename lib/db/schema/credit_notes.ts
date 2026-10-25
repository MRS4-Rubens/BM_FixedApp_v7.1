import { pgTable, text, timestamp, uuid, integer, date, unique, index, check } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { businesses } from './businesses';
import { invoices } from './invoices';
import { financialYears } from './financial_years';
import { users } from './users';
import { lifecycleStatusEnum } from './enums';
import { creditNoteLineItems } from './credit_note_line_items';

export const creditNotes = pgTable('credit_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  business_id: uuid('business_id').notNull().references(() => businesses.id),
  original_invoice_id: uuid('original_invoice_id').notNull().references(() => invoices.id),
  financial_year_id: uuid('financial_year_id').notNull().references(() => financialYears.id),
  credit_note_sequence: integer('credit_note_sequence'),
  credit_note_number: text('credit_note_number').notNull(),
  reason: text('reason').notNull(),
  lifecycle_status: lifecycleStatusEnum('lifecycle_status').notNull().default('draft'),
  issue_date: date('issue_date'),
  subtotal_paise: integer('subtotal_paise').notNull().default(0),
  total_cgst_paise: integer('total_cgst_paise').notNull().default(0),
  total_sgst_paise: integer('total_sgst_paise').notNull().default(0),
  total_igst_paise: integer('total_igst_paise').notNull().default(0),
  total_tax_paise: integer('total_tax_paise').notNull().default(0),
  grand_total_paise: integer('grand_total_paise').notNull().default(0),
  pdf_storage_key: text('pdf_storage_key'),
  finalized_at: timestamp('finalized_at', { withTimezone: true }),

  // Anti-fraud & Statutory Audit Trail Lifecycle Fields (CGST Rule 53 / GSTR-1 Table 13 Compliant)
  status: text('status').notNull().default('active'), // 'active' | 'voided'
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
  index('credit_notes_lifecycle_status_idx').on(table.lifecycle_status),
  index('credit_notes_status_idx').on(table.status),
  index('credit_notes_biz_lifecycle_status_date_idx').on(
    table.business_id,
    table.lifecycle_status,
    table.status,
    table.issue_date
  ),
  // DB-001: money can never be negative.
  check('credit_notes_money_nonneg', sql`${table.subtotal_paise} >= 0 AND ${table.total_tax_paise} >= 0 AND ${table.grand_total_paise} >= 0`),
  // DB-001: a finalized credit note must carry its number, finalization time and issue date.
  check('credit_notes_final_requires_number', sql`${table.lifecycle_status} = 'draft' OR (${table.credit_note_sequence} IS NOT NULL AND ${table.finalized_at} IS NOT NULL AND ${table.issue_date} IS NOT NULL)`)
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
