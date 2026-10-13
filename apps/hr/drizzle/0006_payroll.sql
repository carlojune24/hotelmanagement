CREATE TABLE "payroll_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"establishment_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"generated_at" timestamp with time zone,
	"locked_by_user_id" uuid,
	"locked_at" timestamp with time zone,
	"released_by_user_id" uuid,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_run_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"establishment_id" uuid NOT NULL,
	"person_ref" text NOT NULL,
	"employee_no" text NOT NULL,
	"employee_name" text NOT NULL,
	"position" text NOT NULL,
	"department" text,
	"pay_basis" text NOT NULL,
	"base_rate_centavos" bigint NOT NULL,
	"gov_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"days_worked" integer DEFAULT 0 NOT NULL,
	"minutes_regular" integer DEFAULT 0 NOT NULL,
	"minutes_overtime" integer DEFAULT 0 NOT NULL,
	"minutes_night_diff" integer DEFAULT 0 NOT NULL,
	"earnings" jsonb NOT NULL,
	"gross_centavos" bigint NOT NULL,
	"deductions" jsonb NOT NULL,
	"employer_contributions" jsonb NOT NULL,
	"net_pay_centavos" bigint NOT NULL,
	"thirteenth_month_accrual_centavos" bigint DEFAULT 0 NOT NULL,
	"adjustments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_by_establishment" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"cutoff_start" date NOT NULL,
	"cutoff_end" date NOT NULL,
	"pay_date" date NOT NULL,
	"frequency" text NOT NULL,
	"day_factor" integer NOT NULL,
	"rates_checked_by_user_id" uuid,
	"rates_checked_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_batches" ADD CONSTRAINT "payroll_batches_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_batches" ADD CONSTRAINT "payroll_batches_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_batches" ADD CONSTRAINT "payroll_batches_locked_by_user_id_users_id_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_batches" ADD CONSTRAINT "payroll_batches_released_by_user_id_users_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_batch_id_payroll_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payroll_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_rates_checked_by_user_id_users_id_fk" FOREIGN KEY ("rates_checked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_batches_run_establishment_idx" ON "payroll_batches" USING btree ("run_id","establishment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_run_lines_run_employee_idx" ON "payroll_run_lines" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_run_lines_batch_idx" ON "payroll_run_lines" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "payroll_runs_organization_idx" ON "payroll_runs" USING btree ("organization_id","cutoff_start");