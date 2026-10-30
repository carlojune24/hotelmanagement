CREATE TABLE "ota_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ota_channels" ADD CONSTRAINT "ota_channels_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ota_channels_hotel_name_idx" ON "ota_channels" USING btree ("hotel_id",lower("name"));
--> statement-breakpoint
-- Every hotel starts with the two OTAs the client uses; staff add others in Settings.
INSERT INTO "ota_channels" ("hotel_id", "name") SELECT h."id", v."n" FROM "hotels" h CROSS JOIN (VALUES ('Agoda'), ('Booking.com')) AS v("n") ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Any OTA name already typed on an order (lower-cased by the first version) becomes a channel, then the order takes the channel's name.
INSERT INTO "ota_channels" ("hotel_id", "name") SELECT DISTINCT "hotel_id", upper(left("ota_name", 1)) || substr("ota_name", 2) FROM "orders" WHERE "ota_name" IS NOT NULL ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "orders" o SET "ota_name" = c."name" FROM "ota_channels" c WHERE o."ota_name" IS NOT NULL AND c."hotel_id" = o."hotel_id" AND lower(c."name") = lower(o."ota_name");
