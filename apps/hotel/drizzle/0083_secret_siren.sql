CREATE TABLE "housekeeping_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"booking_id" uuid,
	"result" text DEFAULT 'no_damage' NOT NULL,
	"note" text,
	"inspected_by_user_id" uuid,
	"inspected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "housekeeping_inspections" ADD CONSTRAINT "housekeeping_inspections_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_inspections" ADD CONSTRAINT "housekeeping_inspections_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_inspections" ADD CONSTRAINT "housekeeping_inspections_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_inspections" ADD CONSTRAINT "housekeeping_inspections_inspected_by_user_id_users_id_fk" FOREIGN KEY ("inspected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "housekeeping_inspections_room_idx" ON "housekeeping_inspections" USING btree ("hotel_id","room_id");--> statement-breakpoint
CREATE INDEX "housekeeping_inspections_booking_idx" ON "housekeeping_inspections" USING btree ("booking_id");