CREATE TABLE "cash_advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"disbursed_at" timestamp with time zone,
	"amortization_per_run_centavos" bigint,
	"remaining_balance_centavos" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dtr_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"schedule_id" uuid,
	"date" date NOT NULL,
	"time_in" timestamp with time zone,
	"time_out" timestamp with time zone,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"ot_minutes" integer DEFAULT 0 NOT NULL,
	"night_diff_minutes" integer DEFAULT 0 NOT NULL,
	"tardiness_minutes" integer DEFAULT 0 NOT NULL,
	"undertime_minutes" integer DEFAULT 0 NOT NULL,
	"is_absent" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"biometric_enroll_id" text,
	"corrected_by_user_id" uuid,
	"correction_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"person_ref" text NOT NULL,
	"employee_no" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"middle_name" text,
	"suffix" text,
	"birthdate" date NOT NULL,
	"sex" text NOT NULL,
	"hired_on" date NOT NULL,
	"employment_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"separated_on" date,
	"position" text NOT NULL,
	"department" text,
	"cost_center" text,
	"pay_basis" text NOT NULL,
	"base_rate_centavos" bigint NOT NULL,
	"gov_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"disbursement" jsonb DEFAULT '{"method":"cash"}'::jsonb NOT NULL,
	"biometric_enroll_id" text,
	"user_id" uuid,
	"extensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "employees_person_ref_unique" UNIQUE("person_ref")
);
--> statement-breakpoint
CREATE TABLE "payroll_run_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"cost_center" text,
	"days_worked" integer DEFAULT 0 NOT NULL,
	"hours_regular_minutes" integer DEFAULT 0 NOT NULL,
	"hours_ot_minutes" integer DEFAULT 0 NOT NULL,
	"hours_night_diff_minutes" integer DEFAULT 0 NOT NULL,
	"earnings" jsonb NOT NULL,
	"gross_centavos" bigint NOT NULL,
	"deductions" jsonb NOT NULL,
	"employer_contributions" jsonb NOT NULL,
	"net_pay_centavos" bigint NOT NULL,
	"thirteenth_month_accrual_centavos" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"cutoff_start" date NOT NULL,
	"cutoff_end" date NOT NULL,
	"pay_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"payroll_run_line_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"emailed_at" timestamp with time zone,
	"emailed_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_payroll_run_line_id_unique" UNIQUE("payroll_run_line_id")
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"is_rest_day" boolean DEFAULT false NOT NULL,
	"start_time" time,
	"end_time" time,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"night_diff_window" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cash_advances" ADD CONSTRAINT "cash_advances_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_advances" ADD CONSTRAINT "cash_advances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_advances" ADD CONSTRAINT "cash_advances_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dtr_entries" ADD CONSTRAINT "dtr_entries_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dtr_entries" ADD CONSTRAINT "dtr_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dtr_entries" ADD CONSTRAINT "dtr_entries_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dtr_entries" ADD CONSTRAINT "dtr_entries_corrected_by_user_id_users_id_fk" FOREIGN KEY ("corrected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_run_line_id_payroll_run_lines_id_fk" FOREIGN KEY ("payroll_run_line_id") REFERENCES "public"."payroll_run_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_advances_hotel_employee_idx" ON "cash_advances" USING btree ("hotel_id","employee_id");--> statement-breakpoint
CREATE INDEX "dtr_entries_hotel_idx" ON "dtr_entries" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "dtr_entries_employee_date_idx" ON "dtr_entries" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "employees_hotel_idx" ON "employees" USING btree ("hotel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_hotel_employee_no_idx" ON "employees" USING btree ("hotel_id","employee_no");--> statement-breakpoint
CREATE INDEX "payroll_run_lines_run_idx" ON "payroll_run_lines" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_run_lines_run_employee_idx" ON "payroll_run_lines" USING btree ("payroll_run_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_runs_hotel_idx" ON "payroll_runs" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "payslips_hotel_idx" ON "payslips" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "schedules_hotel_idx" ON "schedules" USING btree ("hotel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedules_employee_date_idx" ON "schedules" USING btree ("employee_id","date");