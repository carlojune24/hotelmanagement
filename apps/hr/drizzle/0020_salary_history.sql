CREATE TABLE "salary_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"pay_basis" text NOT NULL,
	"base_rate_centavos" bigint NOT NULL,
	"previous_pay_basis" text,
	"previous_rate_centavos" bigint,
	"remarks" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salary_history" ADD CONSTRAINT "salary_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_history" ADD CONSTRAINT "salary_history_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "salary_history_employee_date_idx" ON "salary_history" USING btree ("employee_id","effective_from");--> statement-breakpoint
-- One starting row per existing employee, so the history is complete from day one.
INSERT INTO "salary_history" ("employee_id", "effective_from", "pay_basis", "base_rate_centavos", "remarks")
SELECT "id", "hired_on", "pay_basis", "base_rate_centavos", 'Starting salary' FROM "employees";
