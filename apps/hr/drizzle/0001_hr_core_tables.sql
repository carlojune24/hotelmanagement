CREATE TABLE "biometric_import_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"establishment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"id_column" integer NOT NULL,
	"datetime_column" integer NOT NULL,
	"has_header" boolean DEFAULT true NOT NULL,
	"date_format" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "biometric_punches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"establishment_id" uuid NOT NULL,
	"upload_id" uuid,
	"source" text DEFAULT 'file' NOT NULL,
	"note" text,
	"added_by_user_id" uuid,
	"enroll_id" text NOT NULL,
	"enroll_key" text NOT NULL,
	"punched_at" timestamp with time zone NOT NULL,
	"source_file" text,
	"imported_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biometric_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"establishment_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"period" text NOT NULL,
	"punch_count" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"establishment_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"credit_minutes" integer,
	"waive_lateness" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dtr_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"establishment_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"schedule_id" uuid,
	"date" date NOT NULL,
	"time_in" timestamp with time zone,
	"time_out" timestamp with time zone,
	"break_out" timestamp with time zone,
	"break_in" timestamp with time zone,
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
	"remarks" text,
	"leave_request_id" uuid,
	"calendar_day_id" uuid,
	"leave_minutes" integer DEFAULT 0 NOT NULL,
	"unapproved_ot_minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"establishment_id" uuid NOT NULL,
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
	"photo_url" text,
	"email" text,
	"position" text NOT NULL,
	"department" text,
	"cost_center" text,
	"pay_basis" text NOT NULL,
	"base_rate_centavos" bigint NOT NULL,
	"gov_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"disbursement" jsonb DEFAULT '{"method":"cash"}'::jsonb NOT NULL,
	"biometric_enroll_id" text,
	"extensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "employees_person_ref_unique" UNIQUE("person_ref")
);
--> statement-breakpoint
CREATE TABLE "leave_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"establishment_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"days" double precision NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"establishment_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"half_day" text,
	"days" double precision NOT NULL,
	"paid" boolean NOT NULL,
	"reason" text,
	"document_note" text,
	"status" text DEFAULT 'approved' NOT NULL,
	"filed_by_user_id" uuid,
	"cancelled_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"establishment_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"statutory" boolean DEFAULT false NOT NULL,
	"paid" boolean DEFAULT true NOT NULL,
	"days_per_year" double precision DEFAULT 0 NOT NULL,
	"day_count" text DEFAULT 'working' NOT NULL,
	"min_service_months" integer DEFAULT 0 NOT NULL,
	"employment_types" text[] DEFAULT '{}' NOT NULL,
	"sex_restriction" text,
	"half_day_allowed" boolean DEFAULT false NOT NULL,
	"carry_over_days" double precision DEFAULT 0 NOT NULL,
	"cash_convertible" boolean DEFAULT false NOT NULL,
	"requires_document" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overtime_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"establishment_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"minutes" integer NOT NULL,
	"reason" text,
	"status" text DEFAULT 'approved' NOT NULL,
	"filed_by_user_id" uuid,
	"cancelled_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"establishment_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"is_rest_day" boolean DEFAULT false NOT NULL,
	"start_time" time,
	"end_time" time,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"break_start" time,
	"break_end" time,
	"night_diff_window" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shift_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"establishment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_rest_day" boolean DEFAULT false NOT NULL,
	"start_time" time,
	"end_time" time,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"break_start" time,
	"break_end" time,
	"night_diff_window" jsonb,
	"tag" text DEFAULT 'neutral' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "establishments" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "establishments" SET "slug" = 'est-' || substr("id"::text, 1, 8) WHERE "slug" IS NULL;--> statement-breakpoint
ALTER TABLE "establishments" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "establishments" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "establishments" ADD COLUMN "address_line" text;--> statement-breakpoint
ALTER TABLE "establishments" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "establishments" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "biometric_import_templates" ADD CONSTRAINT "biometric_import_templates_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_punches" ADD CONSTRAINT "biometric_punches_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_punches" ADD CONSTRAINT "biometric_punches_upload_id_biometric_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."biometric_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_punches" ADD CONSTRAINT "biometric_punches_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_punches" ADD CONSTRAINT "biometric_punches_imported_by_user_id_users_id_fk" FOREIGN KEY ("imported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_uploads" ADD CONSTRAINT "biometric_uploads_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_uploads" ADD CONSTRAINT "biometric_uploads_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_days" ADD CONSTRAINT "calendar_days_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dtr_entries" ADD CONSTRAINT "dtr_entries_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dtr_entries" ADD CONSTRAINT "dtr_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dtr_entries" ADD CONSTRAINT "dtr_entries_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dtr_entries" ADD CONSTRAINT "dtr_entries_corrected_by_user_id_users_id_fk" FOREIGN KEY ("corrected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dtr_entries" ADD CONSTRAINT "dtr_entries_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dtr_entries" ADD CONSTRAINT "dtr_entries_calendar_day_id_calendar_days_id_fk" FOREIGN KEY ("calendar_day_id") REFERENCES "public"."calendar_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_adjustments" ADD CONSTRAINT "leave_adjustments_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_adjustments" ADD CONSTRAINT "leave_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_adjustments" ADD CONSTRAINT "leave_adjustments_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_adjustments" ADD CONSTRAINT "leave_adjustments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_filed_by_user_id_users_id_fk" FOREIGN KEY ("filed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_filed_by_user_id_users_id_fk" FOREIGN KEY ("filed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "biometric_import_templates_establishment_idx" ON "biometric_import_templates" USING btree ("establishment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "biometric_import_templates_establishment_name_idx" ON "biometric_import_templates" USING btree ("establishment_id","name") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "biometric_punches_unique_idx" ON "biometric_punches" USING btree ("establishment_id","enroll_key","punched_at");--> statement-breakpoint
CREATE INDEX "biometric_punches_establishment_time_idx" ON "biometric_punches" USING btree ("establishment_id","punched_at");--> statement-breakpoint
CREATE INDEX "biometric_uploads_establishment_period_idx" ON "biometric_uploads" USING btree ("establishment_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_days_establishment_date_idx" ON "calendar_days" USING btree ("establishment_id","date");--> statement-breakpoint
CREATE INDEX "dtr_entries_establishment_idx" ON "dtr_entries" USING btree ("establishment_id");--> statement-breakpoint
CREATE INDEX "dtr_entries_employee_date_idx" ON "dtr_entries" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "employees_establishment_idx" ON "employees" USING btree ("establishment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_establishment_employee_no_idx" ON "employees" USING btree ("establishment_id","employee_no");--> statement-breakpoint
CREATE INDEX "leave_adjustments_employee_year_idx" ON "leave_adjustments" USING btree ("employee_id","year");--> statement-breakpoint
CREATE INDEX "leave_requests_establishment_dates_idx" ON "leave_requests" USING btree ("establishment_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "leave_requests_employee_idx" ON "leave_requests" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_establishment_code_idx" ON "leave_types" USING btree ("establishment_id","code");--> statement-breakpoint
CREATE INDEX "overtime_requests_establishment_date_idx" ON "overtime_requests" USING btree ("establishment_id","date");--> statement-breakpoint
CREATE INDEX "overtime_requests_employee_date_idx" ON "overtime_requests" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "schedules_establishment_idx" ON "schedules" USING btree ("establishment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedules_employee_date_idx" ON "schedules" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "shift_templates_establishment_idx" ON "shift_templates" USING btree ("establishment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_templates_establishment_name_idx" ON "shift_templates" USING btree ("establishment_id","name") WHERE deleted_at is null;--> statement-breakpoint
ALTER TABLE "establishments" ADD CONSTRAINT "establishments_slug_unique" UNIQUE("slug");