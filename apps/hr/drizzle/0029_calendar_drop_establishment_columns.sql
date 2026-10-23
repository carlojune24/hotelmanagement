ALTER TABLE "calendar_days" DROP CONSTRAINT "calendar_days_establishment_id_establishments_id_fk";
--> statement-breakpoint
ALTER TABLE "calendar_days" DROP CONSTRAINT "calendar_days_submitted_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "calendar_days" DROP CONSTRAINT "calendar_days_decided_by_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "calendar_days_establishment_date_idx";--> statement-breakpoint
ALTER TABLE "calendar_days" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "calendar_days_org_date_idx" ON "calendar_days" USING btree ("organization_id","date");--> statement-breakpoint
ALTER TABLE "calendar_days" DROP COLUMN "establishment_id";--> statement-breakpoint
ALTER TABLE "calendar_days" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "calendar_days" DROP COLUMN "submitted_by_user_id";--> statement-breakpoint
ALTER TABLE "calendar_days" DROP COLUMN "submitted_at";--> statement-breakpoint
ALTER TABLE "calendar_days" DROP COLUMN "decided_by_user_id";--> statement-breakpoint
ALTER TABLE "calendar_days" DROP COLUMN "decided_at";--> statement-breakpoint
ALTER TABLE "calendar_days" DROP COLUMN "decision_note";--> statement-breakpoint
ALTER TABLE "calendar_days" DROP COLUMN "proposal_note";