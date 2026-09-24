UPDATE "dining_items"
SET "photos" = jsonb_build_array(jsonb_build_object('url', "photo_url", 'tag', 'cover'))
WHERE "photo_url" IS NOT NULL AND jsonb_array_length("photos") = 0;--> statement-breakpoint
ALTER TABLE "dining_items" DROP COLUMN "photo_url";
