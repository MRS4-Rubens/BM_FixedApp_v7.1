-- COMP-001: Freeze seller snapshots on document finalization and enforce document immutability.
--
-- HAND-EDITED after `drizzle-kit generate`.
-- 1. All column additions use ADD COLUMN IF NOT EXISTS.
-- 2. Backfill existing finalized documents with snapshots from business profile.
-- 3. Immutability trigger guards temporarily disabled only for the backfill within this migration.
-- 4. Check constraints added NOT VALID then validated.

-- ============ 1. Add snapshot columns ============
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "seller_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "seller_trade_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "seller_address_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "seller_state_code_snapshot" varchar(2);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "seller_phone_snapshot" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "seller_alternate_phone_snapshot" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "seller_email_snapshot" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "seller_nature_of_business_snapshot" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "seller_pan_snapshot" varchar(10);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "seller_bank_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "terms_snapshot" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "logo_storage_key_snapshot" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "seller_snapshot_source" text;--> statement-breakpoint

ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "seller_gstin_snapshot" varchar(15);--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "seller_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "seller_trade_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "seller_address_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "seller_state_code_snapshot" varchar(2);--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "seller_phone_snapshot" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "seller_alternate_phone_snapshot" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "seller_email_snapshot" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "seller_nature_of_business_snapshot" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "seller_pan_snapshot" varchar(10);--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "seller_bank_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "terms_snapshot" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "logo_storage_key_snapshot" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "seller_snapshot_source" text;--> statement-breakpoint

-- ============ 2. Backfill finalized documents ============
-- IMPERFECT BY DESIGN: backfilled snapshots reflect the business profile at migration time, not at finalization time; flagged seller_snapshot_source = 'backfilled_from_profile'. Original midnight finalized_at values cannot be recovered.
ALTER TABLE "invoices" DISABLE TRIGGER "bm_invoices_guard";--> statement-breakpoint
UPDATE "invoices" AS i
SET "seller_name_snapshot" = b."legal_name",
    "seller_trade_name_snapshot" = b."trade_name",
    "seller_address_snapshot" = jsonb_build_object('line1', b."address_line1", 'line2', b."address_line2", 'city', b."city", 'pincode', b."pincode"),
    "seller_state_code_snapshot" = b."state_code",
    "seller_phone_snapshot" = b."phone",
    "seller_alternate_phone_snapshot" = b."alternate_phone",
    "seller_email_snapshot" = b."email",
    "seller_nature_of_business_snapshot" = b."nature_of_business",
    "seller_pan_snapshot" = b."pan",
    "seller_bank_snapshot" = CASE
      WHEN b."bank_account_name" IS NULL AND b."bank_account_number" IS NULL AND b."bank_ifsc" IS NULL AND b."bank_name" IS NULL THEN NULL
      ELSE jsonb_build_object('accountName', b."bank_account_name", 'accountNumber', b."bank_account_number", 'ifsc', b."bank_ifsc", 'bankName', b."bank_name") END,
    "terms_snapshot" = b."invoice_terms",
    "logo_storage_key_snapshot" = b."logo_storage_key",
    "seller_snapshot_source" = 'backfilled_from_profile'
FROM "businesses" b
WHERE b."id" = i."business_id" AND i."lifecycle_status" = 'finalized' AND i."seller_name_snapshot" IS NULL;--> statement-breakpoint
ALTER TABLE "invoices" ENABLE TRIGGER "bm_invoices_guard";--> statement-breakpoint

ALTER TABLE "credit_notes" DISABLE TRIGGER "bm_credit_notes_guard";--> statement-breakpoint
UPDATE "credit_notes" AS cn
SET "seller_name_snapshot" = b."legal_name",
    "seller_trade_name_snapshot" = b."trade_name",
    "seller_address_snapshot" = jsonb_build_object('line1', b."address_line1", 'line2', b."address_line2", 'city', b."city", 'pincode', b."pincode"),
    "seller_state_code_snapshot" = b."state_code",
    "seller_phone_snapshot" = b."phone",
    "seller_alternate_phone_snapshot" = b."alternate_phone",
    "seller_email_snapshot" = b."email",
    "seller_nature_of_business_snapshot" = b."nature_of_business",
    "seller_pan_snapshot" = b."pan",
    "seller_bank_snapshot" = CASE
      WHEN b."bank_account_name" IS NULL AND b."bank_account_number" IS NULL AND b."bank_ifsc" IS NULL AND b."bank_name" IS NULL THEN NULL
      ELSE jsonb_build_object('accountName', b."bank_account_name", 'accountNumber', b."bank_account_number", 'ifsc', b."bank_ifsc", 'bankName', b."bank_name") END,
    "terms_snapshot" = b."invoice_terms",
    "logo_storage_key_snapshot" = b."logo_storage_key",
    "seller_snapshot_source" = 'backfilled_from_profile',
    "seller_gstin_snapshot" = COALESCE(inv."seller_gstin_snapshot", b."gstin")
FROM "businesses" b, "invoices" inv
WHERE b."id" = cn."business_id" AND inv."id" = cn."original_invoice_id" AND cn."lifecycle_status" = 'finalized' AND cn."seller_name_snapshot" IS NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ENABLE TRIGGER "bm_credit_notes_guard";--> statement-breakpoint

-- ============ 3. CHECK constraints ============
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_final_requires_seller_snapshot";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_final_requires_seller_snapshot" CHECK ("invoices"."lifecycle_status" = 'draft' OR ("invoices"."seller_name_snapshot" IS NOT NULL AND "invoices"."seller_address_snapshot" IS NOT NULL AND "invoices"."seller_state_code_snapshot" IS NOT NULL AND "invoices"."seller_snapshot_source" IS NOT NULL)) NOT VALID;--> statement-breakpoint

ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_seller_snapshot_source_valid";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_seller_snapshot_source_valid" CHECK ("invoices"."seller_snapshot_source" IS NULL OR "invoices"."seller_snapshot_source" IN ('captured_at_finalization', 'backfilled_from_profile')) NOT VALID;--> statement-breakpoint

ALTER TABLE "credit_notes" DROP CONSTRAINT IF EXISTS "credit_notes_final_requires_seller_snapshot";--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_final_requires_seller_snapshot" CHECK ("credit_notes"."lifecycle_status" = 'draft' OR ("credit_notes"."seller_name_snapshot" IS NOT NULL AND "credit_notes"."seller_address_snapshot" IS NOT NULL AND "credit_notes"."seller_state_code_snapshot" IS NOT NULL AND "credit_notes"."seller_snapshot_source" IS NOT NULL AND "credit_notes"."seller_gstin_snapshot" IS NOT NULL)) NOT VALID;--> statement-breakpoint

ALTER TABLE "credit_notes" DROP CONSTRAINT IF EXISTS "credit_notes_seller_snapshot_source_valid";--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_seller_snapshot_source_valid" CHECK ("credit_notes"."seller_snapshot_source" IS NULL OR "credit_notes"."seller_snapshot_source" IN ('captured_at_finalization', 'backfilled_from_profile')) NOT VALID;--> statement-breakpoint

-- ============ 4. Validate constraints ============
ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_final_requires_seller_snapshot";--> statement-breakpoint
ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_seller_snapshot_source_valid";--> statement-breakpoint
ALTER TABLE "credit_notes" VALIDATE CONSTRAINT "credit_notes_final_requires_seller_snapshot";--> statement-breakpoint
ALTER TABLE "credit_notes" VALIDATE CONSTRAINT "credit_notes_seller_snapshot_source_valid";
