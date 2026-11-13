ALTER TABLE "businesses" ADD COLUMN "signature_storage_key" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "signature_storage_key_snapshot" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "signature_storage_key_snapshot" text;