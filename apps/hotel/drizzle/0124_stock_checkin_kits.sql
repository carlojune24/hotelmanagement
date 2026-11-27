CREATE TYPE "public"."stock_kit_basis" AS ENUM('room', 'guest');--> statement-breakpoint
ALTER TYPE "public"."stock_movement_type" ADD VALUE 'checkin_kit';--> statement-breakpoint
CREATE TABLE "stock_checkin_kit_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"room_type_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"qty_milli" bigint NOT NULL,
	"per" "stock_kit_basis" DEFAULT 'room' NOT NULL,
	CONSTRAINT "stock_checkin_kit_lines_qty_positive" CHECK ("stock_checkin_kit_lines"."qty_milli" > 0)
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_checkin_kit_lines" ADD CONSTRAINT "stock_checkin_kit_lines_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_checkin_kit_lines" ADD CONSTRAINT "stock_checkin_kit_lines_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_checkin_kit_lines" ADD CONSTRAINT "stock_checkin_kit_lines_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_checkin_kit_lines_uq" ON "stock_checkin_kit_lines" USING btree ("room_type_id","stock_item_id");--> statement-breakpoint
CREATE INDEX "stock_checkin_kit_lines_hotel_idx" ON "stock_checkin_kit_lines" USING btree ("hotel_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_booking_idx" ON "stock_movements" USING btree ("booking_id");