CREATE TABLE "separation_clearance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"separation_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone,
	"done_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "separation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"separation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text
);
--> statement-breakpoint
CREATE TABLE "separations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"last_day" date NOT NULL,
	"note" text,
	"status" text DEFAULT 'in_process' NOT NULL,
	"final_pay_paid_on" date,
	"final_pay_paid_by_user_id" uuid,
	"cleared_at" timestamp with time zone,
	"cleared_by_user_id" uuid,
	"started_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_loan_payments" ADD COLUMN "separation_id" uuid;--> statement-breakpoint
ALTER TABLE "separation_clearance" ADD CONSTRAINT "separation_clearance_separation_id_separations_id_fk" FOREIGN KEY ("separation_id") REFERENCES "public"."separations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "separation_clearance" ADD CONSTRAINT "separation_clearance_done_by_user_id_users_id_fk" FOREIGN KEY ("done_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "separation_items" ADD CONSTRAINT "separation_items_separation_id_separations_id_fk" FOREIGN KEY ("separation_id") REFERENCES "public"."separations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "separation_items" ADD CONSTRAINT "separation_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "separations" ADD CONSTRAINT "separations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "separations" ADD CONSTRAINT "separations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "separations" ADD CONSTRAINT "separations_final_pay_paid_by_user_id_users_id_fk" FOREIGN KEY ("final_pay_paid_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "separations" ADD CONSTRAINT "separations_cleared_by_user_id_users_id_fk" FOREIGN KEY ("cleared_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "separations" ADD CONSTRAINT "separations_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "separation_clearance_separation_idx" ON "separation_clearance" USING btree ("separation_id");--> statement-breakpoint
CREATE INDEX "separation_items_separation_idx" ON "separation_items" USING btree ("separation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "separations_employee_idx" ON "separations" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "separations_org_status_idx" ON "separations" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "employee_loan_payments" ADD CONSTRAINT "employee_loan_payments_separation_id_separations_id_fk" FOREIGN KEY ("separation_id") REFERENCES "public"."separations"("id") ON DELETE restrict ON UPDATE no action;