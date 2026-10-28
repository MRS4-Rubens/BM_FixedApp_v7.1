import { pgTable, text, varchar, timestamp, uuid, integer, numeric, index, check } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { creditNotes } from './credit_notes';
import { invoiceLineItems } from './invoice_line_items';
import { products } from './products';

export const creditNoteLineItems = pgTable('credit_note_line_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  credit_note_id: uuid('credit_note_id').notNull().references(() => creditNotes.id, { onDelete: 'cascade' }),
  original_line_item_id: uuid('original_line_item_id').references(() => invoiceLineItems.id),
  product_id: uuid('product_id').references(() => products.id),
  description: text('description').notNull(),
  hsn_sac_code: varchar('hsn_sac_code', { length: 8 }).notNull(),
  quantity: numeric('quantity', { precision: 10, scale: 3 }).notNull(),
  unit_of_measurement: text('unit_of_measurement').notNull(),
  unit_price_paise: integer('unit_price_paise').notNull(),
  discount_paise: integer('discount_paise').notNull().default(0),
  taxable_value_paise: integer('taxable_value_paise').notNull(),
  tax_rate_percentage: numeric('tax_rate_percentage', { precision: 5, scale: 2 }).notNull(),
  cgst_paise: integer('cgst_paise').notNull().default(0),
  sgst_paise: integer('sgst_paise').notNull().default(0),
  igst_paise: integer('igst_paise').notNull().default(0),
  line_total_paise: integer('line_total_paise').notNull(),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index('credit_note_line_items_credit_note_id_idx').on(table.credit_note_id),
  index('credit_note_line_items_original_line_item_id_idx').on(table.original_line_item_id),
  // DB-001: quantities must be positive; money columns may not be negative.
  check('cnli_nonneg', sql`${table.quantity} > 0 AND ${table.unit_price_paise} >= 0 AND ${table.discount_paise} >= 0 AND ${table.taxable_value_paise} >= 0`),
  check('cnli_original_line_required', sql`${table.original_line_item_id} IS NOT NULL`)
]);

export const creditNoteLineItemsRelations = relations(creditNoteLineItems, ({ one }) => ({
  creditNote: one(creditNotes, {
    fields: [creditNoteLineItems.credit_note_id],
    references: [creditNotes.id]
  }),
  originalLineItem: one(invoiceLineItems, {
    fields: [creditNoteLineItems.original_line_item_id],
    references: [invoiceLineItems.id]
  }),
  product: one(products, {
    fields: [creditNoteLineItems.product_id],
    references: [products.id]
  })
}));
