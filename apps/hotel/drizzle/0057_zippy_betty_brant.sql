CREATE TYPE "public"."promo_discount_type" AS ENUM('percentage', 'fixed_amount');--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"discount_type" "promo_discount_type" NOT NULL,
	"discount_bps" integer,
	"discount_amount_centavos" bigint,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"promo_code_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"code" text NOT NULL,
	"discount_centavos" bigint NOT NULL,
	"folio_charge_id" uuid,
	"voided_by_user_id" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "rate_plans_promo_code_idx";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_centavos" bigint;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "discount_centavos" bigint;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promo_codes_hotel_idx" ON "promo_codes" USING btree ("hotel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_hotel_code_idx" ON "promo_codes" USING btree ("hotel_id","code");--> statement-breakpoint
CREATE INDEX "promo_redemptions_hotel_idx" ON "promo_redemptions" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "promo_redemptions_booking_idx" ON "promo_redemptions" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "promo_redemptions_promo_code_idx" ON "promo_redemptions" USING btree ("promo_code_id");--> statement-breakpoint
ALTER TABLE "rate_plans" DROP COLUMN "promo_code";