ALTER TABLE "leave_types" DROP CONSTRAINT "leave_types_establishment_id_establishments_id_fk";
--> statement-breakpoint
DROP INDEX "leave_types_establishment_code_idx";--> statement-breakpoint
ALTER TABLE "leave_types" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_organization_code_idx" ON "leave_types" USING btree ("organization_id","code");--> statement-breakpoint
ALTER TABLE "leave_types" DROP COLUMN "establishment_id";