CREATE TABLE "business_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by" uuid NOT NULL,
	"accepted_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "business_invitations_status_valid" CHECK ("business_invitations"."status" IN ('pending', 'accepted', 'revoked')),
	CONSTRAINT "business_invitations_role_valid" CHECK ("business_invitations"."role" IN ('staff')),
	CONSTRAINT "business_invitations_email_normalised" CHECK ("business_invitations"."email" = lower(btrim("business_invitations"."email")) AND "business_invitations"."email" <> ''),
	CONSTRAINT "business_invitations_accept_fields" CHECK (("business_invitations"."status" = 'accepted') = ("business_invitations"."accepted_by" IS NOT NULL AND "business_invitations"."accepted_at" IS NOT NULL)),
	CONSTRAINT "business_invitations_revoke_fields" CHECK (("business_invitations"."status" = 'revoked') = ("business_invitations"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "business_invitations" ADD CONSTRAINT "business_invitations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_invitations" ADD CONSTRAINT "business_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_invitations" ADD CONSTRAINT "business_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_invitations_business_id_idx" ON "business_invitations" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_invitations_one_pending_per_email" ON "business_invitations" USING btree ("business_id","email") WHERE "business_invitations"."status" = 'pending';