ALTER TABLE "room_types" ADD COLUMN "extra_bed_capacity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_rooms" ADD COLUMN "extra_beds" integer DEFAULT 0 NOT NULL;