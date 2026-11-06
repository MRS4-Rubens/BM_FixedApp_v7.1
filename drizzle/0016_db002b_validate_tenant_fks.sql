-- DB-002 PART B: validate the cross-tenant composite foreign keys against EXISTING rows, then remove the three
-- single-column foreign keys they make redundant.
--
-- HAND-EDITED after `drizzle-kit generate` (which produced only the three DROP statements). Edits: (a) the three
-- composite keys are VALIDATED first. If any legacy row links across businesses, VALIDATE fails and the whole migration
-- (one transaction) is rolled back: nothing is dropped and the database is left exactly as it was; (b) a defensive
-- check refuses to drop anything unless all three composite keys are validated; (c) drops are idempotent.
--
-- Deliberately KEPT: invoice_line_items.product_id and credit_note_line_items.product_id -> products(id). They have no
-- composite replacement (tenant safety for products is enforced by the bm_*_line_items_tenant triggers).
--
-- A composite key (business_id, X) -> parent (business_id, id) also guarantees that X exists, and a NULL customer_id is
-- still ignored (MATCH SIMPLE), so removing the old single-column keys loses no protection.

-- ============ 1. Validate existing rows (fails the whole migration if a cross-tenant legacy row exists) ============
ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_customer_same_biz";--> statement-breakpoint
ALTER TABLE "credit_notes" VALIDATE CONSTRAINT "credit_notes_invoice_same_biz";--> statement-breakpoint
ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_invoice_same_biz";--> statement-breakpoint

-- ============ 2. Safety net: never drop the old keys unless every composite key is validated ============
DO $do$ BEGIN
  IF (SELECT count(*) FROM pg_constraint
        WHERE conname IN ('invoices_customer_same_biz', 'credit_notes_invoice_same_biz', 'payments_invoice_same_biz')
          AND convalidated) <> 3 THEN
    RAISE EXCEPTION 'DB-002 part B refused: the three composite tenant foreign keys are not all present and validated';
  END IF;
END $do$;--> statement-breakpoint

-- ============ 3. Remove the now-redundant single-column foreign keys ============
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "credit_notes" DROP CONSTRAINT IF EXISTS "credit_notes_original_invoice_id_invoices_id_fk";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_invoice_id_invoices_id_fk";
