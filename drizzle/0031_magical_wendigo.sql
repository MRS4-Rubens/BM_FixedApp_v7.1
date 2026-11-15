CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_requests" ADD COLUMN "paid_to_vpa" text;--> statement-breakpoint
ALTER TABLE "subscription_requests" ADD COLUMN "paid_to_account" text;--> statement-breakpoint
ALTER TABLE "subscription_requests" ADD COLUMN "paid_to_bank_ifsc" text;--> statement-breakpoint
ALTER TABLE "subscription_requests" ADD COLUMN "subscription_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;