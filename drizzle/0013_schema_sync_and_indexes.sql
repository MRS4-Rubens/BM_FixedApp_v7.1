-- 1. Sync users.email column and index
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint

-- 2. Allow NULL on credit_notes.credit_note_sequence for draft credit notes
ALTER TABLE "credit_notes" ALTER COLUMN "credit_note_sequence" DROP NOT NULL;--> statement-breakpoint

-- 3. Sync void audit columns on credit_notes
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "voided_by" uuid REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "void_reason" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "void_notes" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_status_idx" ON "credit_notes" USING btree ("status");--> statement-breakpoint

-- 4. Sync void audit columns on payments
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "voided_by" uuid REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "void_reason" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "void_notes" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint

-- 5. Single-column & composite indexes for reporting, quota, and reconciliation queries (Issue #06)
CREATE INDEX IF NOT EXISTS "invoices_invoice_date_idx" ON "invoices" USING btree ("invoice_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_lifecycle_status_idx" ON "credit_notes" USING btree ("lifecycle_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_payment_date_idx" ON "payments" USING btree ("payment_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_biz_lifecycle_date_idx" ON "invoices" USING btree ("business_id", "lifecycle_status", "invoice_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_biz_created_at_idx" ON "invoices" USING btree ("business_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_biz_lifecycle_status_date_idx" ON "credit_notes" USING btree ("business_id", "lifecycle_status", "status", "issue_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_invoice_status_idx" ON "payments" USING btree ("invoice_id", "status");--> statement-breakpoint

-- 6. Ensure ON DELETE CASCADE on child line-item foreign keys (Issue #06)
ALTER TABLE "invoice_line_items"
  DROP CONSTRAINT IF EXISTS "invoice_line_items_invoice_id_invoices_id_fk",
  ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk"
    FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "credit_note_line_items"
  DROP CONSTRAINT IF EXISTS "credit_note_line_items_credit_note_id_credit_notes_id_fk",
  ADD CONSTRAINT "credit_note_line_items_credit_note_id_credit_notes_id_fk"
    FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
