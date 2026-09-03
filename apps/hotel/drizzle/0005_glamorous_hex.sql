CREATE TYPE "public"."room_category" AS ENUM('standard', 'deluxe', 'suite', 'executive');--> statement-breakpoint
ALTER TYPE "public"."room_operational_status" ADD VALUE 'under_maintenance';--> statement-breakpoint
CREATE TABLE "seasonal_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"rate_plan_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"price_centavos" bigint,
	"multiplier_bps" integer,
	"min_stay_nights" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rate_plans" ADD COLUMN "inclusions" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD COLUMN "weekend_price_centavos" bigint;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD COLUMN "weekend_days" integer[] DEFAULT '{5,6}' NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD COLUMN "extra_child_fee_centavos" bigint;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD COLUMN "child_free_max_age" integer;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD COLUMN "extra_bed_fee_centavos" bigint;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD COLUMN "min_stay_nights" integer;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD COLUMN "max_stay_nights" integer;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "category" "room_category";--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "photos" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "is_connecting" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "seasonal_rates" ADD CONSTRAINT "seasonal_rates_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasonal_rates" ADD CONSTRAINT "seasonal_rates_rate_plan_id_rate_plans_id_fk" FOREIGN KEY ("rate_plan_id") REFERENCES "public"."rate_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seasonal_rates_hotel_idx" ON "seasonal_rates" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "seasonal_rates_plan_idx" ON "seasonal_rates" USING btree ("rate_plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_types_hotel_code_idx" ON "room_types" USING btree ("hotel_id","code");