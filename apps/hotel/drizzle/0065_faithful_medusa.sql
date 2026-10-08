CREATE TYPE "public"."dining_reservation_status" AS ENUM('pending', 'confirmed', 'seated', 'completed', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TABLE "dining_reservation_tables" (
	"reservation_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	CONSTRAINT "dining_reservation_tables_reservation_id_table_id_pk" PRIMARY KEY("reservation_id","table_id")
);
--> statement-breakpoint
CREATE TABLE "dining_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"dining_item_id" uuid NOT NULL,
	"code" text NOT NULL,
	"access_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" "dining_reservation_status" DEFAULT 'pending' NOT NULL,
	"guest_name" text NOT NULL,
	"guest_phone" text,
	"guest_email" text,
	"party_size" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"remarks" text,
	"source" text DEFAULT 'online' NOT NULL,
	"booking_id" uuid,
	"created_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"dining_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"seats" integer NOT NULL,
	"area" text,
	"x" integer DEFAULT 0 NOT NULL,
	"y" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "reservations_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "seating_open" text;--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "last_seating" text;--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "slot_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "turn_minutes" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "max_party_size" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "advance_days" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "min_notice_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_reservation_tables" ADD CONSTRAINT "dining_reservation_tables_reservation_id_dining_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."dining_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_reservation_tables" ADD CONSTRAINT "dining_reservation_tables_table_id_dining_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dining_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_reservations" ADD CONSTRAINT "dining_reservations_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_reservations" ADD CONSTRAINT "dining_reservations_dining_item_id_dining_items_id_fk" FOREIGN KEY ("dining_item_id") REFERENCES "public"."dining_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_reservations" ADD CONSTRAINT "dining_reservations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_reservations" ADD CONSTRAINT "dining_reservations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_dining_item_id_dining_items_id_fk" FOREIGN KEY ("dining_item_id") REFERENCES "public"."dining_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dining_res_tables_table_idx" ON "dining_reservation_tables" USING btree ("table_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dining_reservations_code_uq" ON "dining_reservations" USING btree ("hotel_id","code");--> statement-breakpoint
CREATE INDEX "dining_reservations_venue_time_idx" ON "dining_reservations" USING btree ("hotel_id","dining_item_id","starts_at");--> statement-breakpoint
CREATE INDEX "dining_tables_venue_idx" ON "dining_tables" USING btree ("hotel_id","dining_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dining_tables_venue_name_uq" ON "dining_tables" USING btree ("dining_item_id","name");