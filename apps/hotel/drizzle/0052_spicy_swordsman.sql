CREATE TYPE "public"."housekeeping_cleanliness_status" AS ENUM('dirty', 'in_progress', 'clean');--> statement-breakpoint
CREATE TYPE "public"."housekeeping_damage_report_status" AS ENUM('pending', 'charged', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."housekeeping_flag_reason" AS ENUM('checkout', 'manual', 'completed');--> statement-breakpoint
CREATE TABLE "housekeeping_damage_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"room_id" uuid,
	"function_hall_id" uuid,
	"booking_id" uuid,
	"hall_booking_id" uuid,
	"description" text NOT NULL,
	"photo_url" text NOT NULL,
	"status" "housekeeping_damage_report_status" DEFAULT 'pending' NOT NULL,
	"reported_by_user_id" uuid,
	"resolved_charge_id" uuid,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "housekeeping_damage_reports_exactly_one_target" CHECK (("housekeeping_damage_reports"."room_id" is not null) <> ("housekeeping_damage_reports"."function_hall_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "housekeeping_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"room_id" uuid,
	"function_hall_id" uuid,
	"status" "housekeeping_cleanliness_status" DEFAULT 'clean' NOT NULL,
	"flag_reason" "housekeeping_flag_reason",
	"triggering_booking_id" uuid,
	"triggering_hall_booking_id" uuid,
	"flagged_at" timestamp with time zone,
	"cleared_at" timestamp with time zone,
	"cleared_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "housekeeping_status_exactly_one_target" CHECK (("housekeeping_status"."room_id" is not null) <> ("housekeeping_status"."function_hall_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "housekeeping_damage_reports" ADD CONSTRAINT "housekeeping_damage_reports_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_damage_reports" ADD CONSTRAINT "housekeeping_damage_reports_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_damage_reports" ADD CONSTRAINT "housekeeping_damage_reports_function_hall_id_function_halls_id_fk" FOREIGN KEY ("function_hall_id") REFERENCES "public"."function_halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_damage_reports" ADD CONSTRAINT "housekeeping_damage_reports_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_damage_reports" ADD CONSTRAINT "housekeeping_damage_reports_hall_booking_id_hall_bookings_id_fk" FOREIGN KEY ("hall_booking_id") REFERENCES "public"."hall_bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_damage_reports" ADD CONSTRAINT "housekeeping_damage_reports_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_damage_reports" ADD CONSTRAINT "housekeeping_damage_reports_resolved_charge_id_folio_charges_id_fk" FOREIGN KEY ("resolved_charge_id") REFERENCES "public"."folio_charges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_damage_reports" ADD CONSTRAINT "housekeeping_damage_reports_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_status" ADD CONSTRAINT "housekeeping_status_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_status" ADD CONSTRAINT "housekeeping_status_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_status" ADD CONSTRAINT "housekeeping_status_function_hall_id_function_halls_id_fk" FOREIGN KEY ("function_hall_id") REFERENCES "public"."function_halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_status" ADD CONSTRAINT "housekeeping_status_triggering_booking_id_bookings_id_fk" FOREIGN KEY ("triggering_booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_status" ADD CONSTRAINT "housekeeping_status_triggering_hall_booking_id_hall_bookings_id_fk" FOREIGN KEY ("triggering_hall_booking_id") REFERENCES "public"."hall_bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_status" ADD CONSTRAINT "housekeeping_status_cleared_by_user_id_users_id_fk" FOREIGN KEY ("cleared_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "housekeeping_damage_reports_hotel_idx" ON "housekeeping_damage_reports" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "housekeeping_damage_reports_room_idx" ON "housekeeping_damage_reports" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "housekeeping_damage_reports_hall_idx" ON "housekeeping_damage_reports" USING btree ("function_hall_id");--> statement-breakpoint
CREATE INDEX "housekeeping_damage_reports_status_idx" ON "housekeeping_damage_reports" USING btree ("hotel_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "housekeeping_status_room_idx" ON "housekeeping_status" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "housekeeping_status_hall_idx" ON "housekeeping_status" USING btree ("function_hall_id");--> statement-breakpoint
CREATE INDEX "housekeeping_status_hotel_idx" ON "housekeeping_status" USING btree ("hotel_id");