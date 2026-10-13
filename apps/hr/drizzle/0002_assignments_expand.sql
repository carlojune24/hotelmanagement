CREATE TABLE "employee_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"establishment_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"is_primary" boolean DEFAULT false NOT NULL,
	"position" text NOT NULL,
	"department" text,
	"biometric_enroll_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_assignments_establishment_idx" ON "employee_assignments" USING btree ("establishment_id");--> statement-breakpoint
CREATE INDEX "employee_assignments_employee_idx" ON "employee_assignments" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_assignments_open_idx" ON "employee_assignments" USING btree ("employee_id","establishment_id") WHERE end_date is null;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_assignments_primary_idx" ON "employee_assignments" USING btree ("employee_id") WHERE is_primary and end_date is null;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Backfill: every employee belongs to their establishment's company...
UPDATE "employees" e SET "organization_id" = s."organization_id" FROM "establishments" s WHERE s."id" = e."establishment_id";--> statement-breakpoint
-- ...and gets one open, primary assignment where they used to live (post, department, device ID move with it).
INSERT INTO "employee_assignments" ("employee_id", "establishment_id", "start_date", "is_primary", "position", "department", "biometric_enroll_id")
SELECT e."id", e."establishment_id", e."hired_on", true, e."position", e."department", e."biometric_enroll_id"
FROM "employees" e WHERE e."deleted_at" IS NULL;--> statement-breakpoint
-- Employee numbers become unique company-wide. Fail loudly (and roll back) rather than half-migrate.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "employees" GROUP BY "organization_id", "employee_no" HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Duplicate employee numbers across establishments: renumber them before running this migration.';
	END IF;
END $$;
