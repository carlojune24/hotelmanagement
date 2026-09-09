CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card', 'gcash', 'maya', 'bank_transfer', 'cheque', 'paymongo', 'house_use');--> statement-breakpoint
CREATE TYPE "public"."payment_purpose" AS ENUM('deposit', 'settlement', 'balance', 'refund');--> statement-breakpoint
CREATE TYPE "public"."cash_account_kind" AS ENUM('cash_drawer', 'petty_cash', 'bank', 'e_wallet', 'undeposited');--> statement-breakpoint
CREATE TYPE "public"."cash_category" AS ENUM('room_revenue', 'hall_revenue', 'incidental_sale', 'deposit', 'deposit_refund', 'refund', 'other_revenue', 'expense', 'payroll', 'statutory_remittance', 'bank_deposit', 'transfer_in', 'transfer_out', 'owner_contribution', 'owner_draw', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."cash_counterparty_type" AS ENUM('guest', 'vendor', 'employee', 'other');--> statement-breakpoint
CREATE TYPE "public"."cash_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."expense_group" AS ENUM('cogs', 'utilities', 'payroll', 'supplies', 'repairs', 'marketing', 'commissions', 'taxes_licenses', 'rent', 'admin', 'other');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('draft', 'approved', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."receivable_status" AS ENUM('open', 'partial', 'settled', 'written_off');--> statement-breakpoint
CREATE TYPE "public"."recurring_cadence" AS ENUM('weekly', 'monthly', 'quarterly', 'annually');--> statement-breakpoint
CREATE TYPE "public"."shift_event_kind" AS ENUM('payout', 'cash_drop', 'pickup', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."cashier_shift_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "cash_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "cash_account_kind" NOT NULL,
	"institution" text,
	"account_ref" text,
	"opening_balance_centavos" bigint DEFAULT 0 NOT NULL,
	"current_balance_centavos" bigint DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"direction" "cash_direction" NOT NULL,
	"category" "cash_category" NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"counterparty_type" "cash_counterparty_type",
	"counterparty_name" text,
	"counterparty_id" uuid,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" uuid,
	"payment_id" uuid,
	"shift_id" uuid,
	"transfer_group_id" uuid,
	"memo" text,
	"recorded_by_user_id" uuid,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cashier_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"opened_by_user_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opening_float_centavos" bigint DEFAULT 0 NOT NULL,
	"status" "cashier_shift_status" DEFAULT 'open' NOT NULL,
	"closed_by_user_id" uuid,
	"closed_at" timestamp with time zone,
	"counted_cash_centavos" bigint,
	"expected_cash_centavos" bigint,
	"variance_centavos" bigint,
	"denominations" jsonb,
	"close_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "day_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"closed_by_user_id" uuid,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"reopened_by_user_id" uuid,
	"reopened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"group" "expense_group" DEFAULT 'other' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"expense_date" date NOT NULL,
	"category_id" uuid NOT NULL,
	"vendor_id" uuid,
	"description" text NOT NULL,
	"vendor_invoice_no" text,
	"gross_centavos" bigint NOT NULL,
	"input_vat_centavos" bigint DEFAULT 0 NOT NULL,
	"net_of_vat_centavos" bigint NOT NULL,
	"is_vatable" boolean DEFAULT false NOT NULL,
	"withholding_tax_centavos" bigint DEFAULT 0 NOT NULL,
	"status" "expense_status" DEFAULT 'draft' NOT NULL,
	"paid_from_account_id" uuid,
	"paid_at" timestamp with time zone,
	"payment_method" "payment_method",
	"payment_reference_no" text,
	"attachment_url" text,
	"notes" text,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"recurring_expense_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "finance_settings" (
	"hotel_id" uuid PRIMARY KEY NOT NULL,
	"default_drawer_account_id" uuid,
	"default_bank_account_id" uuid,
	"undeposited_account_id" uuid,
	"auto_post_online_payments" boolean DEFAULT true NOT NULL,
	"require_expense_approval" boolean DEFAULT true NOT NULL,
	"lock_on_day_close" boolean DEFAULT true NOT NULL,
	"require_open_shift_for_cash_payment" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receivables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"folio_id" uuid,
	"booking_id" uuid,
	"hall_booking_id" uuid,
	"bill_to_name" text NOT NULL,
	"bill_to_company" text,
	"reference_no" text,
	"original_amount_centavos" bigint NOT NULL,
	"outstanding_centavos" bigint NOT NULL,
	"status" "receivable_status" DEFAULT 'open' NOT NULL,
	"opened_by_user_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"settled_at" timestamp with time zone,
	"written_off_by_user_id" uuid,
	"write_off_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"vendor_id" uuid,
	"description" text NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"is_vatable" boolean DEFAULT false NOT NULL,
	"cadence" "recurring_cadence" NOT NULL,
	"anchor_day" integer DEFAULT 1 NOT NULL,
	"next_due_on" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shift_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"kind" "shift_event_kind" NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"reason" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tin" text,
	"address" text,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "method" "payment_method" DEFAULT 'cash' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "purpose" "payment_purpose" DEFAULT 'settlement' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "folio_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "cash_account_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "tendered_centavos" bigint;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "change_centavos" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reference_no" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "cheque_date" date;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "recorded_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "voided_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_shift_id_cashier_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."cashier_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_reopened_by_user_id_users_id_fk" FOREIGN KEY ("reopened_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_from_account_id_cash_accounts_id_fk" FOREIGN KEY ("paid_from_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring_expense_id_recurring_expenses_id_fk" FOREIGN KEY ("recurring_expense_id") REFERENCES "public"."recurring_expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_default_drawer_account_id_cash_accounts_id_fk" FOREIGN KEY ("default_drawer_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_default_bank_account_id_cash_accounts_id_fk" FOREIGN KEY ("default_bank_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_undeposited_account_id_cash_accounts_id_fk" FOREIGN KEY ("undeposited_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_folio_id_folios_id_fk" FOREIGN KEY ("folio_id") REFERENCES "public"."folios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_hall_booking_id_hall_bookings_id_fk" FOREIGN KEY ("hall_booking_id") REFERENCES "public"."hall_bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_written_off_by_user_id_users_id_fk" FOREIGN KEY ("written_off_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_events" ADD CONSTRAINT "shift_events_shift_id_cashier_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."cashier_shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_events" ADD CONSTRAINT "shift_events_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_accounts_hotel_idx" ON "cash_accounts" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "cash_movements_hotel_date_idx" ON "cash_movements" USING btree ("hotel_id","business_date");--> statement-breakpoint
CREATE INDEX "cash_movements_account_idx" ON "cash_movements" USING btree ("hotel_id","cash_account_id");--> statement-breakpoint
CREATE INDEX "cash_movements_source_idx" ON "cash_movements" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "cash_movements_shift_idx" ON "cash_movements" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "cashier_shifts_hotel_idx" ON "cashier_shifts" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "cashier_shifts_drawer_idx" ON "cashier_shifts" USING btree ("cash_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cashier_shifts_one_open_per_drawer" ON "cashier_shifts" USING btree ("cash_account_id") WHERE status = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "day_closes_hotel_date_idx" ON "day_closes" USING btree ("hotel_id","business_date");--> statement-breakpoint
CREATE INDEX "expense_categories_hotel_idx" ON "expense_categories" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "expenses_hotel_date_idx" ON "expenses" USING btree ("hotel_id","expense_date");--> statement-breakpoint
CREATE INDEX "expenses_status_idx" ON "expenses" USING btree ("hotel_id","status");--> statement-breakpoint
CREATE INDEX "receivables_hotel_status_idx" ON "receivables" USING btree ("hotel_id","status");--> statement-breakpoint
CREATE INDEX "recurring_expenses_hotel_idx" ON "recurring_expenses" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "shift_events_shift_idx" ON "shift_events" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "vendors_hotel_idx" ON "vendors" USING btree ("hotel_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_folio_idx" ON "payments" USING btree ("folio_id");--> statement-breakpoint
CREATE INDEX "payments_shift_idx" ON "payments" USING btree ("shift_id");