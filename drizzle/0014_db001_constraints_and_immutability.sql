-- DB-001: CHECK constraints + statutory immutability of finalized records.
--
-- HAND-EDITED after `drizzle-kit generate` (the CHECK definitions below mirror lib/db/schema/*.ts so the
-- snapshot stays in sync). Edits: (a) every statement is idempotent; (b) constraints are added NOT VALID and
-- then VALIDATED in this same migration, so a migration that meets legacy rows that break a rule FAILS AS A
-- WHOLE (migrations run in one transaction => the database is left unchanged); (c) the trigger functions and
-- triggers at the bottom are NOT representable in drizzle's schema/snapshot and are maintained here by hand.
--
-- Trigger design note: finalized rows are protected with an ALLOW-LIST of columns that may legitimately change
-- after finalization. Any column not on the list (including columns added by later migrations, e.g. COMP-001
-- snapshots) is immutable by default. If a future feature must write a NEW column on a finalized row, that
-- feature's migration must replace the function below and add the column to its allow-list.

-- ============ 1. CHECK constraints ============
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_money_nonneg";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_money_nonneg" CHECK ("invoices"."subtotal_paise" >= 0 AND "invoices"."total_tax_paise" >= 0 AND "invoices"."grand_total_paise" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_final_requires_number";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_final_requires_number" CHECK ("invoices"."lifecycle_status" = 'draft' OR ("invoices"."invoice_sequence" IS NOT NULL AND "invoices"."finalized_at" IS NOT NULL AND "invoices"."invoice_date" IS NOT NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "invoice_line_items" DROP CONSTRAINT IF EXISTS "ili_nonneg";--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "ili_nonneg" CHECK ("invoice_line_items"."quantity" > 0 AND "invoice_line_items"."unit_price_paise" >= 0 AND "invoice_line_items"."discount_paise" >= 0 AND "invoice_line_items"."taxable_value_paise" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "credit_notes" DROP CONSTRAINT IF EXISTS "credit_notes_money_nonneg";--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_money_nonneg" CHECK ("credit_notes"."subtotal_paise" >= 0 AND "credit_notes"."total_tax_paise" >= 0 AND "credit_notes"."grand_total_paise" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "credit_notes" DROP CONSTRAINT IF EXISTS "credit_notes_final_requires_number";--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_final_requires_number" CHECK ("credit_notes"."lifecycle_status" = 'draft' OR ("credit_notes"."credit_note_sequence" IS NOT NULL AND "credit_notes"."finalized_at" IS NOT NULL AND "credit_notes"."issue_date" IS NOT NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "credit_note_line_items" DROP CONSTRAINT IF EXISTS "cnli_nonneg";--> statement-breakpoint
ALTER TABLE "credit_note_line_items" ADD CONSTRAINT "cnli_nonneg" CHECK ("credit_note_line_items"."quantity" > 0 AND "credit_note_line_items"."unit_price_paise" >= 0 AND "credit_note_line_items"."discount_paise" >= 0 AND "credit_note_line_items"."taxable_value_paise" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_amount_positive";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_paise" > 0) NOT VALID;--> statement-breakpoint

-- ============ 2. Validate existing rows (fails the whole migration if legacy data violates a rule) ============
ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_money_nonneg";--> statement-breakpoint
ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_final_requires_number";--> statement-breakpoint
ALTER TABLE "invoice_line_items" VALIDATE CONSTRAINT "ili_nonneg";--> statement-breakpoint
ALTER TABLE "credit_notes" VALIDATE CONSTRAINT "credit_notes_money_nonneg";--> statement-breakpoint
ALTER TABLE "credit_notes" VALIDATE CONSTRAINT "credit_notes_final_requires_number";--> statement-breakpoint
ALTER TABLE "credit_note_line_items" VALIDATE CONSTRAINT "cnli_nonneg";--> statement-breakpoint
ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_amount_positive";--> statement-breakpoint

-- ============ 3. Immutability trigger functions ============
CREATE OR REPLACE FUNCTION public.bm_guard_invoices() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  mutable_cols CONSTANT text[] := ARRAY['payment_status','pdf_storage_key','archival_status','archival_attempts','archived_at','emailed_at','email_send_count','updated_at'];
  changed_cols text;
BEGIN
  IF OLD.lifecycle_status::text <> 'finalized' THEN
    -- Drafts are freely editable/deletable; the draft -> finalized transition is allowed here.
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BM_IMMUTABLE_RECORD: finalized invoice % cannot be deleted', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  SELECT string_agg(k, ', ' ORDER BY k) INTO changed_cols
  FROM jsonb_object_keys(to_jsonb(NEW)) AS k
  WHERE k <> ALL (mutable_cols)
    AND (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k);

  IF changed_cols IS NOT NULL THEN
    RAISE EXCEPTION 'BM_IMMUTABLE_RECORD: finalized invoice % cannot change column(s): %', OLD.id, changed_cols
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$fn$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.bm_guard_credit_notes() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  mutable_cols CONSTANT text[] := ARRAY['status','voided_at','voided_by','void_reason','void_notes','pdf_storage_key','updated_at'];
  changed_cols text;
BEGIN
  IF OLD.lifecycle_status::text <> 'finalized' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BM_IMMUTABLE_RECORD: finalized credit note % cannot be deleted', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  SELECT string_agg(k, ', ' ORDER BY k) INTO changed_cols
  FROM jsonb_object_keys(to_jsonb(NEW)) AS k
  WHERE k <> ALL (mutable_cols)
    AND (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k);

  IF changed_cols IS NOT NULL THEN
    RAISE EXCEPTION 'BM_IMMUTABLE_RECORD: finalized credit note % cannot change column(s): %', OLD.id, changed_cols
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$fn$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.bm_guard_invoice_line_items() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  parent_status text;
BEGIN
  -- Check the parent the row belongs to (and, if re-parented, the new parent as well).
  -- FOR SHARE blocks a concurrent finalize of the parent until this transaction ends, closing the race window.
  -- A missing parent (ON DELETE CASCADE from a deleted draft) is allowed.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT i.lifecycle_status::text INTO parent_status FROM public.invoices i WHERE i.id = OLD.invoice_id FOR SHARE;
    IF parent_status = 'finalized' THEN
      RAISE EXCEPTION 'BM_IMMUTABLE_RECORD: line items of finalized invoice % cannot be % ', OLD.invoice_id, lower(TG_OP)
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    parent_status := NULL;
    SELECT i.lifecycle_status::text INTO parent_status FROM public.invoices i WHERE i.id = NEW.invoice_id FOR SHARE;
    IF parent_status = 'finalized' THEN
      RAISE EXCEPTION 'BM_IMMUTABLE_RECORD: line items of finalized invoice % cannot be % ', NEW.invoice_id, lower(TG_OP)
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.bm_guard_credit_note_line_items() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT c.lifecycle_status::text INTO parent_status FROM public.credit_notes c WHERE c.id = OLD.credit_note_id FOR SHARE;
    IF parent_status = 'finalized' THEN
      RAISE EXCEPTION 'BM_IMMUTABLE_RECORD: line items of finalized credit note % cannot be % ', OLD.credit_note_id, lower(TG_OP)
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    parent_status := NULL;
    SELECT c.lifecycle_status::text INTO parent_status FROM public.credit_notes c WHERE c.id = NEW.credit_note_id FOR SHARE;
    IF parent_status = 'finalized' THEN
      RAISE EXCEPTION 'BM_IMMUTABLE_RECORD: line items of finalized credit note % cannot be % ', NEW.credit_note_id, lower(TG_OP)
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;--> statement-breakpoint

-- ============ 4. Triggers ============
DROP TRIGGER IF EXISTS "bm_invoices_guard" ON "invoices";--> statement-breakpoint
CREATE TRIGGER "bm_invoices_guard" BEFORE UPDATE OR DELETE ON "invoices" FOR EACH ROW EXECUTE FUNCTION public.bm_guard_invoices();--> statement-breakpoint
DROP TRIGGER IF EXISTS "bm_credit_notes_guard" ON "credit_notes";--> statement-breakpoint
CREATE TRIGGER "bm_credit_notes_guard" BEFORE UPDATE OR DELETE ON "credit_notes" FOR EACH ROW EXECUTE FUNCTION public.bm_guard_credit_notes();--> statement-breakpoint
DROP TRIGGER IF EXISTS "bm_invoice_line_items_guard" ON "invoice_line_items";--> statement-breakpoint
CREATE TRIGGER "bm_invoice_line_items_guard" BEFORE INSERT OR UPDATE OR DELETE ON "invoice_line_items" FOR EACH ROW EXECUTE FUNCTION public.bm_guard_invoice_line_items();--> statement-breakpoint
DROP TRIGGER IF EXISTS "bm_credit_note_line_items_guard" ON "credit_note_line_items";--> statement-breakpoint
CREATE TRIGGER "bm_credit_note_line_items_guard" BEFORE INSERT OR UPDATE OR DELETE ON "credit_note_line_items" FOR EACH ROW EXECUTE FUNCTION public.bm_guard_credit_note_line_items();