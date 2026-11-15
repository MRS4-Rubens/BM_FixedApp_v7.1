CREATE TABLE "platform_settings_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb NOT NULL,
	"changed_by" uuid NOT NULL,
	"changed_by_email" text,
	"request_context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_settings_history" ADD CONSTRAINT "platform_settings_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_settings_history_key_created_at_idx" ON "platform_settings_history" USING btree ("key","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.bm_guard_platform_settings_history() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'platform_settings_history is append-only' USING ERRCODE = 'check_violation';
END;
$fn$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "bm_platform_settings_history_guard" ON "platform_settings_history";--> statement-breakpoint
CREATE TRIGGER "bm_platform_settings_history_guard" BEFORE UPDATE OR DELETE ON "platform_settings_history" FOR EACH ROW EXECUTE FUNCTION public.bm_guard_platform_settings_history();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.bm_guard_subscription_request_money() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.plan_name IS DISTINCT FROM OLD.plan_name
     OR NEW.billing_cycle IS DISTINCT FROM OLD.billing_cycle
     OR NEW.amount_paise IS DISTINCT FROM OLD.amount_paise
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
     OR NEW.paid_to_vpa IS DISTINCT FROM OLD.paid_to_vpa
     OR NEW.paid_to_account IS DISTINCT FROM OLD.paid_to_account
     OR NEW.paid_to_bank_ifsc IS DISTINCT FROM OLD.paid_to_bank_ifsc THEN
    RAISE EXCEPTION 'subscription_requests payment fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "bm_subscription_request_money_guard" ON "subscription_requests";--> statement-breakpoint
CREATE TRIGGER "bm_subscription_request_money_guard" BEFORE UPDATE ON "subscription_requests" FOR EACH ROW EXECUTE FUNCTION public.bm_guard_subscription_request_money();
