ALTER TABLE "leave_types" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
UPDATE "leave_types" t SET "organization_id" = e."organization_id" FROM "establishments" e WHERE e."id" = t."establishment_id";--> statement-breakpoint
-- Leave types become one company list: per (company, code) keep the oldest in-use row, point every
-- request and balance adjustment at it, and switch it on if any establishment had it on.
CREATE TEMP TABLE "_leave_type_keep" AS
SELECT "id",
	first_value("id") OVER (PARTITION BY "organization_id", "code" ORDER BY "active" DESC, "created_at" ASC, "id") AS "keeper",
	bool_or("active") OVER (PARTITION BY "organization_id", "code") AS "any_active"
FROM "leave_types";--> statement-breakpoint
UPDATE "leave_requests" r SET "leave_type_id" = k."keeper" FROM "_leave_type_keep" k WHERE r."leave_type_id" = k."id" AND k."id" <> k."keeper";--> statement-breakpoint
UPDATE "leave_adjustments" a SET "leave_type_id" = k."keeper" FROM "_leave_type_keep" k WHERE a."leave_type_id" = k."id" AND k."id" <> k."keeper";--> statement-breakpoint
UPDATE "leave_types" t SET "active" = k."any_active" FROM "_leave_type_keep" k WHERE t."id" = k."id" AND k."id" = k."keeper";--> statement-breakpoint
DELETE FROM "leave_types" t USING "_leave_type_keep" k WHERE t."id" = k."id" AND k."id" <> k."keeper";--> statement-breakpoint
DROP TABLE "_leave_type_keep";
