CREATE TABLE "calendar_day_establishments" (
	"calendar_day_id" uuid NOT NULL,
	"establishment_id" uuid NOT NULL,
	CONSTRAINT "calendar_day_establishments_calendar_day_id_establishment_id_pk" PRIMARY KEY("calendar_day_id","establishment_id")
);
--> statement-breakpoint
ALTER TABLE "calendar_days" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_days" ADD COLUMN "scope" text DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_day_establishments" ADD CONSTRAINT "calendar_day_establishments_calendar_day_id_calendar_days_id_fk" FOREIGN KEY ("calendar_day_id") REFERENCES "public"."calendar_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_day_establishments" ADD CONSTRAINT "calendar_day_establishments_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_days" ADD CONSTRAINT "calendar_days_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "calendar_days" c SET "organization_id" = e."organization_id" FROM "establishments" e WHERE e."id" = c."establishment_id";--> statement-breakpoint
-- A proposal nobody approved never affected anything; the proposal flow goes away, so these go too.
DELETE FROM "calendar_days" WHERE "status" <> 'approved';--> statement-breakpoint
-- The same entry made on several establishments becomes one entry that lists them.
CREATE TEMP TABLE "cd_merge" AS
SELECT c."id",
	first_value(c."id") OVER (
		PARTITION BY c."organization_id", c."date", c."name", c."kind", c."credit_minutes", c."waive_lateness"
		ORDER BY c."created_at", c."id"
	) AS "keep_id",
	c."establishment_id"
FROM "calendar_days" c;--> statement-breakpoint
INSERT INTO "calendar_day_establishments" ("calendar_day_id", "establishment_id")
SELECT "keep_id", "establishment_id" FROM "cd_merge" ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "dtr_entries" d SET "calendar_day_id" = m."keep_id" FROM "cd_merge" m WHERE d."calendar_day_id" = m."id" AND m."id" <> m."keep_id";--> statement-breakpoint
DELETE FROM "calendar_days" c USING "cd_merge" m WHERE c."id" = m."id" AND m."id" <> m."keep_id";--> statement-breakpoint
DROP TABLE "cd_merge";--> statement-breakpoint
-- Everything migrated is limited to the establishments it was entered for, unless that is every establishment.
UPDATE "calendar_days" SET "scope" = 'selected';--> statement-breakpoint
UPDATE "calendar_days" c SET "scope" = 'company'
WHERE (SELECT count(*) FROM "calendar_day_establishments" x WHERE x."calendar_day_id" = c."id")
	>= (SELECT count(*) FROM "establishments" e WHERE e."organization_id" = c."organization_id" AND e."deleted_at" IS NULL);--> statement-breakpoint
DELETE FROM "calendar_day_establishments" x USING "calendar_days" c WHERE x."calendar_day_id" = c."id" AND c."scope" = 'company';
