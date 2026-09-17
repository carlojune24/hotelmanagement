CREATE TYPE "public"."security_deposit_status" AS ENUM('held', 'settled', 'voided');--> statement-breakpoint
ALTER TYPE "public"."cash_category" ADD VALUE 'security_deposit_hold';--> statement-breakpoint
ALTER TYPE "public"."cash_category" ADD VALUE 'security_deposit_refund';--> statement-breakpoint
CREATE TABLE "security_deposit_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"amount_centavos" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "security_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"booking_id" uuid,
	"security_deposit_policy_id" uuid,
	"status" "security_deposit_status" DEFAULT 'held' NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference_no" text,
	"collected_by_user_id" uuid,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"forfeited_centavos" bigint,
	"refunded_centavos" bigint,
	"settled_by_user_id" uuid,
	"settled_at" timestamp with time zone,
	"voided_by_user_id" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rate_plans" ADD COLUMN "security_deposit_policy_id" uuid;--> statement-breakpoint
ALTER TABLE "security_deposit_policies" ADD CONSTRAINT "security_deposit_policies_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_deposits" ADD CONSTRAINT "security_deposits_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_deposits" ADD CONSTRAINT "security_deposits_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_deposits" ADD CONSTRAINT "security_deposits_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_deposits" ADD CONSTRAINT "security_deposits_collected_by_user_id_users_id_fk" FOREIGN KEY ("collected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_deposits" ADD CONSTRAINT "security_deposits_settled_by_user_id_users_id_fk" FOREIGN KEY ("settled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_deposits" ADD CONSTRAINT "security_deposits_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_deposit_policies_hotel_idx" ON "security_deposit_policies" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "security_deposits_hotel_idx" ON "security_deposits" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "security_deposits_booking_idx" ON "security_deposits" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "security_deposits_one_held_per_booking_idx" ON "security_deposits" USING btree ("booking_id") WHERE "security_deposits"."status" = 'held';--> statement-breakpoint
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_security_deposit_policy_id_security_deposit_policies_id_fk" FOREIGN KEY ("security_deposit_policy_id") REFERENCES "public"."security_deposit_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_plans" DROP COLUMN "deposit_centavos";