ALTER TABLE "folios" ALTER COLUMN "booking_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "folios" ADD COLUMN "hall_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "folios" ADD CONSTRAINT "folios_hall_booking_id_hall_bookings_id_fk" FOREIGN KEY ("hall_booking_id") REFERENCES "public"."hall_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folios" ADD CONSTRAINT "folios_hall_booking_id_unique" UNIQUE("hall_booking_id");--> statement-breakpoint
ALTER TABLE "folios" ADD CONSTRAINT "folios_exactly_one_target" CHECK (("folios"."booking_id" is not null) <> ("folios"."hall_booking_id" is not null));