-- Every dish now belongs to exactly one prep station. Backfill dishes that have none: give each
-- affected hotel a "Kitchen" station (reusing one if it already has that name) and assign them
-- to it. Soft-deleted dishes are included so the NOT NULL below cannot fail.
INSERT INTO "dining_stations" ("hotel_id", "name")
SELECT DISTINCT "hotel_id", 'Kitchen' FROM "dining_menu_items" WHERE "station_id" IS NULL
ON CONFLICT ("hotel_id", "name") DO NOTHING;--> statement-breakpoint
UPDATE "dining_menu_items" m SET "station_id" = s."id"
FROM "dining_stations" s
WHERE m."station_id" IS NULL AND s."hotel_id" = m."hotel_id" AND s."name" = 'Kitchen';--> statement-breakpoint
ALTER TABLE "dining_menu_items" DROP CONSTRAINT "dining_menu_items_station_id_dining_stations_id_fk";
--> statement-breakpoint
ALTER TABLE "dining_menu_items" ALTER COLUMN "station_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_menu_items" ADD CONSTRAINT "dining_menu_items_station_id_dining_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."dining_stations"("id") ON DELETE no action ON UPDATE no action;
