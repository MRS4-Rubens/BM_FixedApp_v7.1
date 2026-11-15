ALTER TABLE "platform_settings" DROP CONSTRAINT "platform_settings_updated_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DROP TRIGGER IF EXISTS "bm_platform_settings_history_guard_truncate" ON "platform_settings_history";--> statement-breakpoint
CREATE TRIGGER "bm_platform_settings_history_guard_truncate" BEFORE TRUNCATE ON "platform_settings_history" FOR EACH STATEMENT EXECUTE FUNCTION public.bm_guard_platform_settings_history();--> statement-breakpoint
ALTER TABLE "platform_settings_history" ENABLE ALWAYS TRIGGER "bm_platform_settings_history_guard";--> statement-breakpoint
ALTER TABLE "platform_settings_history" ENABLE ALWAYS TRIGGER "bm_platform_settings_history_guard_truncate";--> statement-breakpoint
ALTER TABLE "subscription_requests" ENABLE ALWAYS TRIGGER "bm_subscription_request_money_guard";
