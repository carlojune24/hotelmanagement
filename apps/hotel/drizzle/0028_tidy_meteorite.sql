CREATE TYPE "public"."shift_chargeback_status" AS ENUM('none', 'owed', 'collected', 'written_off');--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD COLUMN "variance_chargeback_status" "shift_chargeback_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD COLUMN "variance_chargeback_centavos" bigint;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD COLUMN "variance_chargeback_note" text;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD COLUMN "variance_chargeback_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD COLUMN "variance_chargeback_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD COLUMN "variance_chargeback_collected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD COLUMN "variance_chargeback_collected_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_variance_chargeback_by_user_id_users_id_fk" FOREIGN KEY ("variance_chargeback_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_variance_chargeback_collected_by_user_id_users_id_fk" FOREIGN KEY ("variance_chargeback_collected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;