CREATE TABLE "pay_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"label" text NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"note" text,
	"applied_line_id" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pay_items" ADD CONSTRAINT "pay_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_items" ADD CONSTRAINT "pay_items_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_items" ADD CONSTRAINT "pay_items_applied_line_id_payroll_run_lines_id_fk" FOREIGN KEY ("applied_line_id") REFERENCES "public"."payroll_run_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_items" ADD CONSTRAINT "pay_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_items_employee_idx" ON "pay_items" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "pay_items_org_idx" ON "pay_items" USING btree ("organization_id","start_date");