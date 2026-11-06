-- DB-005: index hardening.
-- * HAND-EDITED after `drizzle-kit generate`: every statement is idempotent; a pre-flight guard fails the
--   WHOLE migration (transaction) with a readable message if production already holds duplicate pending claims.
-- * Plain CREATE INDEX (not CONCURRENTLY) on purpose: drizzle runs migrations inside a transaction, where
--   CONCURRENTLY is illegal. Tables are small; each build is sub-second.
-- * No data is modified by this migration.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "subscription_requests" WHERE "status" = 'pending' GROUP BY "business_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DB-005 pre-flight failed: at least one business has more than one pending subscription request. Approve or reject the duplicates in the admin console, then re-run this migration.';
  END IF;
END
$$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_requests_one_pending_per_biz" ON "subscription_requests" USING btree ("business_id") WHERE "subscription_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_archival_retry_idx" ON "invoices" USING btree ("finalized_at") WHERE "invoices"."archival_status" IN ('pending', 'failed') AND "invoices"."archival_attempts" < 5;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_biz_name_idx" ON "customers" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_biz_active_idx" ON "products" USING btree ("business_id","is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_line_items_product_idx" ON "invoice_line_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_biz_created_idx" ON "audit_log" USING btree ("business_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_requests_user_id_idx" ON "subscription_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_biz_customer_idx" ON "invoices" USING btree ("business_id","customer_id");--> statement-breakpoint
DROP INDEX IF EXISTS "invoices_lifecycle_status_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "invoices_payment_status_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "invoices_business_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "credit_notes_lifecycle_status_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "credit_notes_status_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "payments_status_idx";
