-- PERF-001. HAND-EDITED after drizzle-kit generate. drizzle-kit runs ALL pending migrations in ONE transaction,
-- so CREATE INDEX CONCURRENTLY is impossible; plain CREATE INDEX IF NOT EXISTS is used (tables are small today).
DO $do$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'PERF-001: pg_trgm is unavailable (%); trigram search indexes will be skipped', SQLERRM;
END $do$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_biz_name_id_idx" ON "customers" USING btree ("business_id","name","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_biz_name_id_idx" ON "products" USING btree ("business_id","name","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_biz_created_id_idx" ON "invoices" USING btree ("business_id","created_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_biz_invoice_date_idx" ON "invoices" USING btree ("business_id","invoice_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_biz_created_id_idx" ON "credit_notes" USING btree ("business_id","created_at" DESC,"id" DESC);--> statement-breakpoint
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS customers_name_trgm_idx ON customers USING gin (name gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS customers_gstin_trgm_idx ON customers USING gin (gstin gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS products_name_trgm_idx ON products USING gin (name gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS products_hsn_trgm_idx ON products USING gin (hsn_sac_code gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS invoices_invoice_number_trgm_idx ON invoices USING gin (invoice_number gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS invoices_billing_name_trgm_idx ON invoices USING gin (billing_name_snapshot gin_trgm_ops)';
  END IF;
END $do$;
