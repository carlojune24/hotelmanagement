CREATE TABLE "cost_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centers_org_code_idx" ON "cost_centers" USING btree ("organization_id","code");--> statement-breakpoint
UPDATE "employees" SET "cost_center" = NULLIF(btrim("cost_center"), '') WHERE "cost_center" IS NOT NULL;--> statement-breakpoint
INSERT INTO "cost_centers" ("organization_id", "code", "name")
SELECT DISTINCT "organization_id", "cost_center", "cost_center" FROM "employees" WHERE "cost_center" IS NOT NULL;
