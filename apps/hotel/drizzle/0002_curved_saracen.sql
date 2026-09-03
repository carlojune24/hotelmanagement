CREATE TYPE "public"."room_operational_status" AS ENUM('available', 'out_of_order');--> statement-breakpoint
CREATE TYPE "public"."smoking_policy" AS ENUM('non_smoking', 'smoking_allowed');--> statement-breakpoint
ALTER TABLE "rate_plans" ADD COLUMN "extra_person_fee_centavos" bigint;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD COLUMN "deposit_centavos" bigint;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "max_adults" integer;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "max_children" integer;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "extra_bed_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "max_extra_beds" integer;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "size_sqm" integer;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "bed_configuration" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "bed_flexible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "flexibility_note" text;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "amenities" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "view_type" text;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "wheelchair_accessible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "roll_in_shower" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "grab_bars" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "smoking_policy" "smoking_policy" DEFAULT 'non_smoking' NOT NULL;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "display_title" text;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "tagline" text;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "short_description" text;--> statement-breakpoint
ALTER TABLE "room_types" ADD COLUMN "photos" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "building_block" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "operational_status" "room_operational_status" DEFAULT 'available' NOT NULL;