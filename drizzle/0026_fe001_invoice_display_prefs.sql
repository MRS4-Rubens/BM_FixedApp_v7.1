-- FE-001: Move invoice display preferences from localStorage to account (businesses.invoice_display_prefs)
-- and snapshot them on finalized invoices (invoices.display_prefs_snapshot).
-- Idempotent: safe to run multiple times.
-- Immutability note: no allow-list change needed in bm_guard_invoices() — new column is frozen after finalization by default.
-- No backfill needed: legacy finalized invoices keep display_prefs_snapshot = NULL (resolves to defaults by design).

ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "invoice_display_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "display_prefs_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "businesses" DROP CONSTRAINT IF EXISTS "businesses_invoice_display_prefs_object";--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_invoice_display_prefs_object" CHECK (jsonb_typeof("businesses"."invoice_display_prefs") = 'object');--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_display_prefs_snapshot_object";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_display_prefs_snapshot_object" CHECK ("invoices"."display_prefs_snapshot" IS NULL OR jsonb_typeof("invoices"."display_prefs_snapshot") = 'object');
