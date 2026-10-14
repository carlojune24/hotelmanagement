CREATE TABLE "employee_loan_skips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"pay_month" text NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_loans" ADD COLUMN "already_paid_centavos" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_loan_skips" ADD CONSTRAINT "employee_loan_skips_loan_id_employee_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."employee_loans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loan_skips" ADD CONSTRAINT "employee_loan_skips_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_loan_skips_loan_month_idx" ON "employee_loan_skips" USING btree ("loan_id","pay_month");