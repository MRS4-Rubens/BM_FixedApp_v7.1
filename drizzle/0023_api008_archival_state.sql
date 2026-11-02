-- Migration: 0023_api008_archival_state
-- Description: API-008 serverless PDF archival hardening.
-- Hand-edited: Idempotent (IF NOT EXISTS), updates DB-001 immutability trigger allow-lists
-- for bm_guard_invoices and bm_guard_credit_notes, backfills existing finalized credit notes,
-- and cleans draft pollution caused by the legacy cron.
-- Backlog note: finalized credit notes without a PDF stay 'pending' and will be archived by the sweep.

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "archival_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "archival_status" "archival_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "archival_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "archival_claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_archival_retry_idx" ON "credit_notes" USING btree ("finalized_at") WHERE "credit_notes"."lifecycle_status" = 'finalized' AND "credit_notes"."archival_status" IN ('pending', 'failed') AND "credit_notes"."archival_attempts" < 5;--> statement-breakpoint

-- Update bm_guard_invoices allow-list to include archival_claimed_at
CREATE OR REPLACE FUNCTION public.bm_guard_invoices() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  mutable_cols CONSTANT text[] := ARRAY['payment_status','pdf_storage_key','archival_status','archival_attempts','archived_at','emailed_at','email_send_count','updated_at','archival_claimed_at'];
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

-- Update bm_guard_credit_notes allow-list to include archival_status, archival_attempts, archived_at, archival_claimed_at
CREATE OR REPLACE FUNCTION public.bm_guard_credit_notes() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  mutable_cols CONSTANT text[] := ARRAY['status','voided_at','voided_by','void_reason','void_notes','pdf_storage_key','updated_at','archival_status','archival_attempts','archived_at','archival_claimed_at'];
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

-- Backfill finalized credit notes that already have a PDF storage key
UPDATE "credit_notes"
SET "archival_status" = 'archived',
    "archived_at" = COALESCE("updated_at", "finalized_at")
WHERE "lifecycle_status" = 'finalized'
  AND "pdf_storage_key" IS NOT NULL
  AND "archival_status" <> 'archived';--> statement-breakpoint

-- Clean draft pollution caused by the old cron
UPDATE "invoices"
SET "archival_attempts" = 0,
    "archival_status" = 'pending'
WHERE "lifecycle_status" = 'draft'
  AND ("archival_attempts" <> 0 OR "archival_status" <> 'pending');
