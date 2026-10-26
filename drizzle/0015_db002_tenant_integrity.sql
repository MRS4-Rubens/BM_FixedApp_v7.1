-- DB-002: cross-tenant referential integrity (PART A: enforce for all NEW writes; existing rows validated later).
--
-- HAND-EDITED after `drizzle-kit generate`. Edits: (a) the UNIQUE (business_id, id) constraints are created BEFORE
-- the composite foreign keys that need them (drizzle emits them in the wrong order); (b) the foreign keys are added
-- NOT VALID: Postgres enforces them for every new/changed row immediately, but does NOT scan existing rows, so this
-- migration cannot fail because of legacy data. They are VALIDATED later (PART B) once API-001 is deployed and the
-- cross-tenant audit queries return zero rows; (c) every statement is idempotent and a re-run never resets a
-- constraint that was already validated; (d) the line-item tenancy triggers are hand-written (drizzle cannot track
-- triggers) and give line-level enforcement for products WITHOUT adding business_id columns to the line-item tables.
--
-- The old single-column foreign keys (invoices_customer_id_customers_id_fk, ...) are intentionally KEPT here; they
-- are removed in PART B after validation.

-- ============ 1. Composite key targets: UNIQUE (business_id, id) ============
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_biz_id_uq' AND conrelid = 'public.customers'::regclass) THEN
    ALTER TABLE "customers" ADD CONSTRAINT "customers_biz_id_uq" UNIQUE ("business_id","id");
  END IF;
END $do$;--> statement-breakpoint
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_biz_id_uq' AND conrelid = 'public.products'::regclass) THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_biz_id_uq" UNIQUE ("business_id","id");
  END IF;
END $do$;--> statement-breakpoint
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_biz_id_uq' AND conrelid = 'public.invoices'::regclass) THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_biz_id_uq" UNIQUE ("business_id","id");
  END IF;
END $do$;--> statement-breakpoint
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_notes_biz_id_uq' AND conrelid = 'public.credit_notes'::regclass) THEN
    ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_biz_id_uq" UNIQUE ("business_id","id");
  END IF;
END $do$;--> statement-breakpoint

-- ============ 2. Composite foreign keys (NOT VALID: enforced for new rows, legacy rows validated in PART B) ============
-- A NULL customer_id (walk-in customer) is NOT checked (MATCH SIMPLE), exactly as before.
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_customer_same_biz' AND conrelid = 'public.invoices'::regclass) THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_same_biz" FOREIGN KEY ("business_id","customer_id") REFERENCES "public"."customers"("business_id","id") ON DELETE no action ON UPDATE no action NOT VALID;
  END IF;
END $do$;--> statement-breakpoint
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_notes_invoice_same_biz' AND conrelid = 'public.credit_notes'::regclass) THEN
    ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_same_biz" FOREIGN KEY ("business_id","original_invoice_id") REFERENCES "public"."invoices"("business_id","id") ON DELETE no action ON UPDATE no action NOT VALID;
  END IF;
END $do$;--> statement-breakpoint
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_invoice_same_biz' AND conrelid = 'public.payments'::regclass) THEN
    ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_same_biz" FOREIGN KEY ("business_id","invoice_id") REFERENCES "public"."invoices"("business_id","id") ON DELETE no action ON UPDATE no action NOT VALID;
  END IF;
END $do$;--> statement-breakpoint

-- ============ 3. Line-level tenancy: a line item's product must belong to the same business as its parent ============
-- Checked only when a row is inserted or its product_id / parent changes, so legacy rows never block normal
-- updates (e.g. the finalize-time recalculation of tax columns). Missing rows are left for the FKs to report.
CREATE OR REPLACE FUNCTION public.bm_guard_invoice_line_item_tenant() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  parent_business uuid;
  product_business uuid;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id AND NEW.invoice_id IS NOT DISTINCT FROM OLD.invoice_id THEN
    RETURN NEW;
  END IF;
  SELECT i.business_id INTO parent_business FROM public.invoices i WHERE i.id = NEW.invoice_id;
  SELECT p.business_id INTO product_business FROM public.products p WHERE p.id = NEW.product_id;
  IF parent_business IS NOT NULL AND product_business IS NOT NULL AND parent_business <> product_business THEN
    RAISE EXCEPTION 'BM_CROSS_TENANT_REFERENCE: product % does not belong to the business of invoice %', NEW.product_id, NEW.invoice_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$fn$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.bm_guard_credit_note_line_item_tenant() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  parent_business uuid;
  product_business uuid;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id AND NEW.credit_note_id IS NOT DISTINCT FROM OLD.credit_note_id THEN
    RETURN NEW;
  END IF;
  SELECT c.business_id INTO parent_business FROM public.credit_notes c WHERE c.id = NEW.credit_note_id;
  SELECT p.business_id INTO product_business FROM public.products p WHERE p.id = NEW.product_id;
  IF parent_business IS NOT NULL AND product_business IS NOT NULL AND parent_business <> product_business THEN
    RAISE EXCEPTION 'BM_CROSS_TENANT_REFERENCE: product % does not belong to the business of credit note %', NEW.product_id, NEW.credit_note_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$fn$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "bm_invoice_line_items_tenant" ON "invoice_line_items";--> statement-breakpoint
CREATE TRIGGER "bm_invoice_line_items_tenant" BEFORE INSERT OR UPDATE OF product_id, invoice_id ON "invoice_line_items" FOR EACH ROW EXECUTE FUNCTION public.bm_guard_invoice_line_item_tenant();--> statement-breakpoint
DROP TRIGGER IF EXISTS "bm_credit_note_line_items_tenant" ON "credit_note_line_items";--> statement-breakpoint
CREATE TRIGGER "bm_credit_note_line_items_tenant" BEFORE INSERT OR UPDATE OF product_id, credit_note_id ON "credit_note_line_items" FOR EACH ROW EXECUTE FUNCTION public.bm_guard_credit_note_line_item_tenant();