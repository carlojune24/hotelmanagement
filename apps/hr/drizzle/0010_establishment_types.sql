CREATE TABLE "establishment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"links_to_hotel_app" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "establishments" ADD COLUMN "type_id" uuid;--> statement-breakpoint
ALTER TABLE "establishment_types" ADD CONSTRAINT "establishment_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "establishment_types_org_name_idx" ON "establishment_types" USING btree ("organization_id","name");--> statement-breakpoint
ALTER TABLE "establishments" ADD CONSTRAINT "establishments_type_id_establishment_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."establishment_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
INSERT INTO "establishment_types" ("organization_id", "name", "links_to_hotel_app")
SELECT "id", t."name", t."links" FROM "organizations" CROSS JOIN (VALUES ('Hotel', true), ('Other', false)) AS t("name", "links");--> statement-breakpoint
UPDATE "establishments" e SET "type_id" = (
	SELECT t."id" FROM "establishment_types" t
	WHERE t."organization_id" = e."organization_id" AND t."links_to_hotel_app" = (e."kind" = 'hotel')
);
