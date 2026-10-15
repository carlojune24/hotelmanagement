CREATE TABLE "employee_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"establishment_id" uuid,
	"kind" text NOT NULL,
	"position" text NOT NULL,
	"pay_basis" text NOT NULL,
	"base_rate_centavos" bigint NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"body" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_on" date NOT NULL,
	"signed_on" date,
	"stored_name" text,
	"original_name" text,
	"content_type" text,
	"size_bytes" integer,
	"void_reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_contracts_employee_idx" ON "employee_contracts" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_contracts_org_end_idx" ON "employee_contracts" USING btree ("organization_id","end_date");