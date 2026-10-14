CREATE TABLE "employee_loan_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"stored_name" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_loan_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" uuid,
	"void_reason" text
);
--> statement-breakpoint
ALTER TABLE "employee_loans" ADD COLUMN "released_on" date;--> statement-breakpoint
ALTER TABLE "employee_loans" ADD COLUMN "term_months" integer;--> statement-breakpoint
ALTER TABLE "employee_loan_documents" ADD CONSTRAINT "employee_loan_documents_loan_id_employee_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."employee_loans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loan_documents" ADD CONSTRAINT "employee_loan_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loan_payments" ADD CONSTRAINT "employee_loan_payments_loan_id_employee_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."employee_loans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loan_payments" ADD CONSTRAINT "employee_loan_payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loan_payments" ADD CONSTRAINT "employee_loan_payments_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_loan_documents_loan_idx" ON "employee_loan_documents" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "employee_loan_payments_loan_idx" ON "employee_loan_payments" USING btree ("loan_id");