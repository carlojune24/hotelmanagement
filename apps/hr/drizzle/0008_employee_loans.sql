CREATE TABLE "employee_loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reference_no" text,
	"principal_centavos" bigint NOT NULL,
	"amortization_centavos" bigint NOT NULL,
	"start_period" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"status_note" text,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_loan_deductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reference_no" text,
	"due_centavos" bigint NOT NULL,
	"deducted_centavos" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_loan_deductions" ADD CONSTRAINT "payroll_loan_deductions_loan_id_employee_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."employee_loans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_loan_deductions" ADD CONSTRAINT "payroll_loan_deductions_line_id_payroll_run_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."payroll_run_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_loans_employee_idx" ON "employee_loans" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_loans_org_status_idx" ON "employee_loans" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_loan_deductions_loan_line_idx" ON "payroll_loan_deductions" USING btree ("loan_id","line_id");