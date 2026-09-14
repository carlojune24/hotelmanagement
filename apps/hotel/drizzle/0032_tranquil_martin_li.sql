CREATE TYPE "public"."ledger_account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."journal_source_type" AS ENUM('cash_movement', 'manual');--> statement-breakpoint
CREATE TYPE "public"."ledger_normal_balance" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TABLE "cash_category_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"category" "cash_category" NOT NULL,
	"account_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_of_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"account_ref" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "ledger_account_type" NOT NULL,
	"subtype" text NOT NULL,
	"normal_balance" "ledger_normal_balance" NOT NULL,
	"parent_id" uuid,
	"is_postable" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chart_of_accounts_account_ref_unique" UNIQUE("account_ref")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"entry_no" text NOT NULL,
	"entry_date" date NOT NULL,
	"memo" text,
	"source_type" "journal_source_type" NOT NULL,
	"source_id" uuid,
	"reversal_of_entry_id" uuid,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_centavos" bigint DEFAULT 0 NOT NULL,
	"credit_centavos" bigint DEFAULT 0 NOT NULL,
	"hotel_id" uuid NOT NULL,
	"department" text,
	"cost_center" text,
	"project" text,
	"counterparty_id" uuid
);
--> statement-breakpoint
CREATE TABLE "api_key_hotel_scopes" (
	"api_key_id" uuid NOT NULL,
	"hotel_id" uuid NOT NULL,
	CONSTRAINT "api_key_hotel_scopes_api_key_id_hotel_id_pk" PRIMARY KEY("api_key_id","hotel_id")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"scopes" text[] DEFAULT '{"finance:read"}' NOT NULL,
	"created_by_user_id" uuid,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD COLUMN "coa_account_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "journal_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD COLUMN "coa_account_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD COLUMN "next_journal_entry_no" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_category_accounts" ADD CONSTRAINT "cash_category_accounts_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_category_accounts" ADD CONSTRAINT "cash_category_accounts_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_hotel_scopes" ADD CONSTRAINT "api_key_hotel_scopes_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_hotel_scopes" ADD CONSTRAINT "api_key_hotel_scopes_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_category_accounts_hotel_category_idx" ON "cash_category_accounts" USING btree ("hotel_id","category");--> statement-breakpoint
CREATE INDEX "chart_of_accounts_hotel_idx" ON "chart_of_accounts" USING btree ("hotel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chart_of_accounts_hotel_code_idx" ON "chart_of_accounts" USING btree ("hotel_id","code");--> statement-breakpoint
CREATE INDEX "journal_entries_hotel_date_idx" ON "journal_entries" USING btree ("hotel_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_entries_hotel_source_idx" ON "journal_entries" USING btree ("hotel_id","source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_hotel_entry_no_idx" ON "journal_entries" USING btree ("hotel_id","entry_no");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_hotel_account_idx" ON "journal_lines" USING btree ("hotel_id","account_id");--> statement-breakpoint
CREATE INDEX "api_key_hotel_scopes_hotel_idx" ON "api_key_hotel_scopes" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");