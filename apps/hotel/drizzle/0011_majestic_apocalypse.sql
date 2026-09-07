CREATE TABLE "room_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_room_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_booking_room_id_booking_rooms_id_fk" FOREIGN KEY ("booking_room_id") REFERENCES "public"."booking_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_assignments_booking_room_idx" ON "room_assignments" USING btree ("booking_room_id");--> statement-breakpoint
CREATE INDEX "room_assignments_room_idx" ON "room_assignments" USING btree ("room_id");