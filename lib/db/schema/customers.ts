import { pgTable, text, varchar, timestamp, uuid, boolean, check, index, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { businesses } from './businesses';
import { invoices } from './invoices';

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  business_id: uuid('business_id').notNull().references(() => businesses.id),
  name: text('name').notNull(),
  gstin: varchar('gstin', { length: 15 }),
  email: text('email'),
  phone: text('phone'),
  address_line1: text('address_line1'),
  address_line2: text('address_line2'),
  city: text('city'),
  state_code: varchar('state_code', { length: 2 }).notNull(),
  pincode: varchar('pincode', { length: 6 }),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  check('customers_gstin_length', sql`length(${table.gstin}) = 15`),
  index('customers_business_id_idx').on(table.business_id),
  index('customers_biz_name_idx').on(table.business_id, table.name),
  // PERF-001: composite keyset index and trigram indexes for list paging and search
  index('customers_biz_name_id_idx').on(table.business_id, table.name, table.id),
  index('customers_name_trgm_idx').using('gin', table.name.op('gin_trgm_ops')),
  index('customers_gstin_trgm_idx').using('gin', table.gstin.op('gin_trgm_ops')),
  // DB-002: lets other tables reference (business_id, id) so a link can never cross tenants.
  unique('customers_biz_id_uq').on(table.business_id, table.id),
  // CUST-GSTIN-UNIQUE: one business can never hold two customers with the same GSTIN.
  // Partial, so any number of customers without a GSTIN stay allowed. GSTINs are stored upper-cased.
  uniqueIndex('customers_biz_gstin_uq').on(table.business_id, table.gstin).where(sql`${table.gstin} IS NOT NULL`)
]);

export const customersRelations = relations(customers, ({ one, many }) => ({
  business: one(businesses, {
    fields: [customers.business_id],
    references: [businesses.id]
  }),
  invoices: many(invoices)
}));
