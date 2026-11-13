ALTER TABLE "businesses" ADD COLUMN "invoice_tagline" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "seller_tagline_snapshot" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "seller_tagline_snapshot" text;
