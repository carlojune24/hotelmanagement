CREATE TYPE "public"."sc_pwd_claimant_type" AS ENUM('senior_citizen', 'pwd');--> statement-breakpoint
CREATE TABLE "sc_pwd_discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"claimant_type" "sc_pwd_claimant_type" NOT NULL,
	"claimant_name" text NOT NULL,
	"id_number" text NOT NULL,
	"discount_bps" integer NOT NULL,
	"base_amount_centavos" bigint NOT NULL,
	"vat_removed_centavos" bigint NOT NULL,
	"discount_centavos" bigint NOT NULL,
	"folio_charge_id" uuid,
	"applied_by_user_id" uuid,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by_user_id" uuid,
	"reversed_at" timestamp with time zone,
	"reversed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bir_settings" ADD COLUMN "sc_pwd_discount_bps" integer DEFAULT 2000 NOT NULL;--> statement-breakpoint
ALTER TABLE "sc_pwd_discounts" ADD CONSTRAINT "sc_pwd_discounts_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_pwd_discounts" ADD CONSTRAINT "sc_pwd_discounts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_pwd_discounts" ADD CONSTRAINT "sc_pwd_discounts_applied_by_user_id_users_id_fk" FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_pwd_discounts" ADD CONSTRAINT "sc_pwd_discounts_reversed_by_user_id_users_id_fk" FOREIGN KEY ("reversed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sc_pwd_discounts_hotel_idx" ON "sc_pwd_discounts" USING btree ("hotel_id","applied_at");--> statement-breakpoint
CREATE INDEX "sc_pwd_discounts_booking_idx" ON "sc_pwd_discounts" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sc_pwd_discounts_one_active_per_booking_idx" ON "sc_pwd_discounts" USING btree ("booking_id") WHERE reversed_at is null;