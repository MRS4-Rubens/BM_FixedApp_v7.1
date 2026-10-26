import { pgTable, text, varchar, timestamp, uuid, integer, numeric, index, check } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { invoices } from './invoices';
import { products } from './products';

export const invoiceLineItems = pgTable('invoice_line_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoice_id: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
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
  index('invoice_line_items_invoice_id_idx').on(table.invoice_id),
  // DB-001: quantities must be positive; money columns may not be negative.
  check('ili_nonneg', sql`${table.quantity} > 0 AND ${table.unit_price_paise} >= 0 AND ${table.discount_paise} >= 0 AND ${table.taxable_value_paise} >= 0`)
]);

export const invoiceLineItemsRelations = relations(invoiceLineItems, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceLineItems.invoice_id],
    references: [invoices.id]
  }),
  product: one(products, {
    fields: [invoiceLineItems.product_id],
    references: [products.id]
  })
}));
