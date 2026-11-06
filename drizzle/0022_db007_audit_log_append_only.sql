ALTER TABLE "audit_log" ADD COLUMN "ip" varchar(45);--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "user_agent" varchar(512);--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.bm_guard_audit_log() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'BM_AUDIT_APPEND_ONLY: audit_log is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$fn$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "bm_audit_log_guard" ON "audit_log";--> statement-breakpoint
CREATE TRIGGER "bm_audit_log_guard" BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION public.bm_guard_audit_log();--> statement-breakpoint
DROP TRIGGER IF EXISTS "bm_audit_log_guard_truncate" ON "audit_log";--> statement-breakpoint
CREATE TRIGGER "bm_audit_log_guard_truncate" BEFORE TRUNCATE ON "audit_log" FOR EACH STATEMENT EXECUTE FUNCTION public.bm_guard_audit_log();--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ALWAYS TRIGGER "bm_audit_log_guard";--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ALWAYS TRIGGER "bm_audit_log_guard_truncate";
