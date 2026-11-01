-- DB-004: closed value domains for free-text state columns.
-- HAND-EDITED after `drizzle-kit generate`. Edits: (a) idempotent (DROP IF EXISTS before ADD); (b) every constraint is
-- added NOT VALID then VALIDATED in this same migration, so if ANY legacy row holds an unexpected value the whole
-- migration (one transaction) fails and the database is left unchanged. Run the pre-flight audit queries from
-- docs/DEPLOYMENT.md before applying to production. (c) No triggers are touched; CHECK additions do not fire them.
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_status_valid";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_valid" CHECK ("payments"."status" IN ('active', 'voided')) NOT VALID;--> statement-breakpoint
ALTER TABLE "credit_notes" DROP CONSTRAINT IF EXISTS "credit_notes_status_valid";--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_status_valid" CHECK ("credit_notes"."status" IN ('active', 'voided')) NOT VALID;--> statement-breakpoint
ALTER TABLE "businesses" DROP CONSTRAINT IF EXISTS "businesses_subscription_plan_valid";--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_subscription_plan_valid" CHECK ("businesses"."subscription_plan" IN ('trial', 'free', 'essentials', 'professional')) NOT VALID;--> statement-breakpoint
ALTER TABLE "businesses" DROP CONSTRAINT IF EXISTS "businesses_subscription_status_valid";--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_subscription_status_valid" CHECK ("businesses"."subscription_status" IN ('trial', 'active', 'expired', 'suspended')) NOT VALID;--> statement-breakpoint
ALTER TABLE "businesses" DROP CONSTRAINT IF EXISTS "businesses_default_invoice_template_valid";--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_default_invoice_template_valid" CHECK ("businesses"."default_invoice_template" IN ('template_1', 'template_2', 'template_3', 'template_4')) NOT VALID;--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_invoice_template_valid";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_invoice_template_valid" CHECK ("invoices"."invoice_template" IN ('template_1', 'template_2', 'template_3', 'template_4')) NOT VALID;--> statement-breakpoint
ALTER TABLE "subscription_requests" DROP CONSTRAINT IF EXISTS "subscription_requests_plan_name_valid";--> statement-breakpoint
ALTER TABLE "subscription_requests" ADD CONSTRAINT "subscription_requests_plan_name_valid" CHECK ("subscription_requests"."plan_name" IN ('trial', 'free', 'essentials', 'professional')) NOT VALID;--> statement-breakpoint
ALTER TABLE "subscription_requests" DROP CONSTRAINT IF EXISTS "subscription_requests_billing_cycle_valid";--> statement-breakpoint
ALTER TABLE "subscription_requests" ADD CONSTRAINT "subscription_requests_billing_cycle_valid" CHECK ("subscription_requests"."billing_cycle" IN ('monthly', 'yearly', 'manual_override')) NOT VALID;--> statement-breakpoint
ALTER TABLE "subscription_requests" DROP CONSTRAINT IF EXISTS "subscription_requests_payment_method_valid";--> statement-breakpoint
ALTER TABLE "subscription_requests" ADD CONSTRAINT "subscription_requests_payment_method_valid" CHECK ("subscription_requests"."payment_method" IN ('upi_qr', 'upi_id', 'bank_transfer', 'manual_override')) NOT VALID;--> statement-breakpoint
ALTER TABLE "subscription_requests" DROP CONSTRAINT IF EXISTS "subscription_requests_status_valid";--> statement-breakpoint
ALTER TABLE "subscription_requests" ADD CONSTRAINT "subscription_requests_status_valid" CHECK ("subscription_requests"."status" IN ('pending', 'approved', 'rejected')) NOT VALID;--> statement-breakpoint
ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_status_valid";--> statement-breakpoint
ALTER TABLE "credit_notes" VALIDATE CONSTRAINT "credit_notes_status_valid";--> statement-breakpoint
ALTER TABLE "businesses" VALIDATE CONSTRAINT "businesses_subscription_plan_valid";--> statement-breakpoint
ALTER TABLE "businesses" VALIDATE CONSTRAINT "businesses_subscription_status_valid";--> statement-breakpoint
ALTER TABLE "businesses" VALIDATE CONSTRAINT "businesses_default_invoice_template_valid";--> statement-breakpoint
ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_invoice_template_valid";--> statement-breakpoint
ALTER TABLE "subscription_requests" VALIDATE CONSTRAINT "subscription_requests_plan_name_valid";--> statement-breakpoint
ALTER TABLE "subscription_requests" VALIDATE CONSTRAINT "subscription_requests_billing_cycle_valid";--> statement-breakpoint
ALTER TABLE "subscription_requests" VALIDATE CONSTRAINT "subscription_requests_payment_method_valid";--> statement-breakpoint
ALTER TABLE "subscription_requests" VALIDATE CONSTRAINT "subscription_requests_status_valid";
