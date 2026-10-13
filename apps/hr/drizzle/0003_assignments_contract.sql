ALTER TABLE "employees" DROP CONSTRAINT "employees_establishment_id_establishments_id_fk";
--> statement-breakpoint
DROP INDEX "employees_establishment_idx";--> statement-breakpoint
DROP INDEX "employees_establishment_employee_no_idx";--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "employees_organization_idx" ON "employees" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_organization_employee_no_idx" ON "employees" USING btree ("organization_id","employee_no");--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "establishment_id";--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "position";--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "department";--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "biometric_enroll_id";