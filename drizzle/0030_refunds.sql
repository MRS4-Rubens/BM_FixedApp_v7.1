ALTER TABLE "invoices" ADD COLUMN "refund_due_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "kind" text DEFAULT 'payment' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_refund_due_valid" CHECK ("invoices"."refund_due_paise" >= 0 AND "invoices"."refund_due_paise" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_kind_valid" CHECK ("payments"."kind" IN ('payment', 'refund'));--> statement-breakpoint
-- REFUND (hand-written below; triggers/functions are not representable in drizzle's schema snapshot).
-- 1. Finalized invoices may now change refund_due_paise (kept in step with payment_status by the app).
CREATE OR REPLACE FUNCTION public.bm_guard_invoices() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  mutable_cols CONSTANT text[] := ARRAY['payment_status','refund_due_paise','pdf_storage_key','archival_status','archival_attempts','archived_at','emailed_at','email_send_count','updated_at','archival_claimed_at','reminder_count','last_reminder_at'];
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
-- 2. Backfill: refund due = money received - reduced bill, when positive. Before this release no refund rows
--    existed, so every active payment row is money received.
UPDATE "invoices" AS i
SET "refund_due_paise" = x.due
FROM (
  SELECT inv.id,
         GREATEST(0,
           COALESCE((SELECT sum(pay."amount_paise") FROM "payments" pay
                     WHERE pay."invoice_id" = inv.id AND pay."business_id" = inv."business_id"
                       AND pay."status" = 'active'), 0)
           - GREATEST(0, inv."grand_total_paise"
               - COALESCE((SELECT sum(cn."grand_total_paise") FROM "credit_notes" cn
                           WHERE cn."original_invoice_id" = inv.id AND cn."business_id" = inv."business_id"
                             AND cn."lifecycle_status" = 'finalized' AND cn."status" = 'active'), 0))
         ) AS due
  FROM "invoices" inv
  WHERE inv."lifecycle_status" = 'finalized'
) AS x
WHERE i.id = x.id AND x.due > 0;--> statement-breakpoint
-- 3. Payments (and refunds) are append-only money records: only voiding may change them, never deletion.
CREATE OR REPLACE FUNCTION public.bm_guard_payments() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  mutable_cols CONSTANT text[] := ARRAY['status','voided_at','voided_by','void_reason','void_notes'];
  changed_cols text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BM_IMMUTABLE_RECORD: payment % cannot be deleted; void it instead', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION 'BM_IMMUTABLE_RECORD: voided payment % cannot change', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  SELECT string_agg(k, ', ' ORDER BY k) INTO changed_cols
  FROM jsonb_object_keys(to_jsonb(NEW)) AS k
  WHERE k <> ALL (mutable_cols)
    AND (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k);

  IF changed_cols IS NOT NULL THEN
    RAISE EXCEPTION 'BM_IMMUTABLE_RECORD: payment % cannot change column(s): %', OLD.id, changed_cols
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$fn$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "bm_payments_guard" ON "payments";--> statement-breakpoint
CREATE TRIGGER "bm_payments_guard" BEFORE UPDATE OR DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION public.bm_guard_payments();
