CREATE TABLE "loan_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"remit_to" text DEFAULT 'none' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_loan_deductions" ADD COLUMN "agency" text;--> statement-breakpoint
ALTER TABLE "loan_types" ADD CONSTRAINT "loan_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loan_types_org_key_idx" ON "loan_types" USING btree ("organization_id","key");--> statement-breakpoint
UPDATE "payroll_loan_deductions" SET "agency" = CASE
	WHEN "kind" LIKE 'sss\_%' THEN 'sss_loan'
	WHEN "kind" LIKE 'pagibig\_%' THEN 'pagibig_loan'
	ELSE NULL END;--> statement-breakpoint
INSERT INTO "loan_types" ("organization_id", "key", "name", "remit_to")
SELECT o."id", t."key", t."name", t."remit_to"
FROM "organizations" o
CROSS JOIN (VALUES
	('sss_salary', 'SSS salary loan', 'sss'),
	('sss_calamity', 'SSS calamity loan', 'sss'),
	('pagibig_mpl', 'Pag-IBIG multi-purpose loan', 'pagibig'),
	('pagibig_calamity', 'Pag-IBIG calamity loan', 'pagibig'),
	('pagibig_housing', 'Pag-IBIG housing loan', 'pagibig'),
	('company', 'Company loan', 'none')
) AS t("key", "name", "remit_to");
