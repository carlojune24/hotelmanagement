ALTER TABLE "memberships" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" DROP COLUMN "role";--> statement-breakpoint
DROP TYPE "public"."membership_role";