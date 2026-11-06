-- API-011: reminder tracking + trigger allow-list extension.
-- HAND-EDITED after `drizzle-kit generate`: (a) idempotent; (b) the trigger function below is NOT representable in
-- drizzle's snapshot and is maintained by hand. It is a copy of the latest bm_guard_invoices() definition
-- (0023_api008_archival_state.sql) with ONLY 'reminder_count' and 'last_reminder_at' added to the allow-list.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "reminder_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "last_reminder_at" timestamp with time zone;--> statement-breakpoint
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_reminder_count_nonneg' AND conrelid = 'public.invoices'::regclass) THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_reminder_count_nonneg" CHECK ("invoices"."reminder_count" >= 0);
  END IF;
END $do$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.bm_guard_invoices() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  mutable_cols CONSTANT text[] := ARRAY['payment_status','pdf_storage_key','archival_status','archival_attempts','archived_at','emailed_at','email_send_count','updated_at','archival_claimed_at','reminder_count','last_reminder_at'];
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
$fn$;
