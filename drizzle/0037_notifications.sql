CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"dedupe_key" text NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"email_state" text DEFAULT 'skipped' NOT NULL,
	"email_attempts" integer DEFAULT 0 NOT NULL,
	"email_claimed_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_user_business_dedupe_uq" UNIQUE("user_id","business_id","dedupe_key"),
	CONSTRAINT "notifications_kind_valid" CHECK ("notifications"."kind" IN ('invoices_overdue', 'invoices_due_soon', 'gst_return_due', 'gst_frequency_missing', 'fy_ending', 'trial_ending', 'plan_expiring', 'plan_expired', 'payment_approved', 'payment_rejected', 'member_joined', 'role_changed', 'pdf_archival_failed')),
	CONSTRAINT "notifications_category_valid" CHECK ("notifications"."category" IN ('money', 'gst', 'account', 'team')),
	CONSTRAINT "notifications_email_state_valid" CHECK ("notifications"."email_state" IN ('skipped', 'pending', 'sending', 'sent', 'failed')),
	CONSTRAINT "notifications_sent_has_time" CHECK (("notifications"."email_state" = 'sent') = ("notifications"."emailed_at" IS NOT NULL)),
	CONSTRAINT "notifications_link_internal" CHECK ("notifications"."link" IS NULL OR ("notifications"."link" LIKE '/%' AND "notifications"."link" NOT LIKE '//%')),
	CONSTRAINT "notifications_text_lengths" CHECK (length("notifications"."title") BETWEEN 1 AND 200 AND length("notifications"."body") BETWEEN 1 AND 1000 AND length("notifications"."dedupe_key") BETWEEN 1 AND 200),
	CONSTRAINT "notifications_email_attempts_nonneg" CHECK ("notifications"."email_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "gst_filing_frequency" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_business_created_idx" ON "notifications" USING btree ("user_id","business_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id","business_id") WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_email_queue_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."email_state" IN ('pending', 'sending');--> statement-breakpoint
CREATE INDEX "notifications_business_id_idx" ON "notifications" USING btree ("business_id");--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_gst_filing_frequency_valid" CHECK ("businesses"."gst_filing_frequency" IS NULL OR "businesses"."gst_filing_frequency" IN ('monthly', 'quarterly', 'not_filing'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_notification_prefs_object" CHECK (jsonb_typeof("users"."notification_prefs") = 'object');