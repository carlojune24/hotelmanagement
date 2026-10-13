CREATE TABLE "bonus_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"establishment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"year" integer NOT NULL,
	"through_date" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"issued_on" date,
	"issued_by_user_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bonus_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_no" text NOT NULL,
	"employee_name" text NOT NULL,
	"position" text,
	"basic_earned_centavos" bigint DEFAULT 0 NOT NULL,
	"late_centavos" bigint DEFAULT 0 NOT NULL,
	"accrued_centavos" bigint DEFAULT 0 NOT NULL,
	"already_paid_centavos" bigint DEFAULT 0 NOT NULL,
	"amount_centavos" bigint DEFAULT 0 NOT NULL,
	"excluded_reason" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bonus_batches" ADD CONSTRAINT "bonus_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_batches" ADD CONSTRAINT "bonus_batches_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_batches" ADD CONSTRAINT "bonus_batches_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_batches" ADD CONSTRAINT "bonus_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_lines" ADD CONSTRAINT "bonus_lines_batch_id_bonus_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."bonus_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_lines" ADD CONSTRAINT "bonus_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bonus_batches_unique_idx" ON "bonus_batches" USING btree ("establishment_id","kind","year","label");--> statement-breakpoint
CREATE UNIQUE INDEX "bonus_lines_batch_employee_idx" ON "bonus_lines" USING btree ("batch_id","employee_id");