ALTER TYPE "public"."role" ADD VALUE 'accountant';--> statement-breakpoint
ALTER TABLE "business_invitations" DROP CONSTRAINT "business_invitations_role_valid";--> statement-breakpoint
ALTER TABLE "business_invitations" ADD CONSTRAINT "business_invitations_role_valid" CHECK ("business_invitations"."role" IN ('staff', 'accountant'));