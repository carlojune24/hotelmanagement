CREATE TYPE "public"."amenity_category" AS ENUM('connectivity', 'comfort', 'bathroom', 'entertainment', 'kitchen', 'outdoor_view', 'safety', 'accessibility', 'services', 'general');--> statement-breakpoint
CREATE TYPE "public"."amenity_scope" AS ENUM('hotel', 'room_type', 'both');--> statement-breakpoint
CREATE TABLE "amenities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"icon" text,
	"category" "amenity_category" DEFAULT 'general' NOT NULL,
	"scope" "amenity_scope" DEFAULT 'both' NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hotel_amenities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"amenity_id" uuid NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_type_amenities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"room_type_id" uuid NOT NULL,
	"amenity_id" uuid NOT NULL,
	"is_highlighted" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amenities" ADD CONSTRAINT "amenities_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_amenities" ADD CONSTRAINT "hotel_amenities_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_amenities" ADD CONSTRAINT "hotel_amenities_amenity_id_amenities_id_fk" FOREIGN KEY ("amenity_id") REFERENCES "public"."amenities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_type_amenities" ADD CONSTRAINT "room_type_amenities_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_type_amenities" ADD CONSTRAINT "room_type_amenities_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_type_amenities" ADD CONSTRAINT "room_type_amenities_amenity_id_amenities_id_fk" FOREIGN KEY ("amenity_id") REFERENCES "public"."amenities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "amenities_hotel_idx" ON "amenities" USING btree ("hotel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "amenities_hotel_slug_idx" ON "amenities" USING btree ("hotel_id","slug");--> statement-breakpoint
CREATE INDEX "hotel_amenities_hotel_idx" ON "hotel_amenities" USING btree ("hotel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hotel_amenities_hotel_amenity_idx" ON "hotel_amenities" USING btree ("hotel_id","amenity_id");--> statement-breakpoint
CREATE INDEX "room_type_amenities_hotel_idx" ON "room_type_amenities" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "room_type_amenities_room_type_idx" ON "room_type_amenities" USING btree ("room_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_type_amenities_type_amenity_idx" ON "room_type_amenities" USING btree ("room_type_id","amenity_id");--> statement-breakpoint
-- Backfill: promote each room type's free-text `amenities` entries into the new
-- per-hotel master list, then link them, before dropping the legacy column.
INSERT INTO "amenities" ("hotel_id", "name", "slug", "category", "scope")
SELECT DISTINCT
	rt."hotel_id",
	trim(a.val) AS name,
	COALESCE(NULLIF(trim(BOTH '-' FROM regexp_replace(regexp_replace(lower(trim(a.val)), '&', ' and ', 'g'), '[^a-z0-9]+', '-', 'g')), ''), 'amenity') AS slug,
	'general'::"amenity_category",
	'room_type'::"amenity_scope"
FROM "room_types" rt
CROSS JOIN LATERAL unnest(rt."amenities") AS a(val)
WHERE trim(a.val) <> ''
ON CONFLICT ("hotel_id", "slug") DO NOTHING;--> statement-breakpoint
INSERT INTO "room_type_amenities" ("hotel_id", "room_type_id", "amenity_id")
SELECT DISTINCT rt."hotel_id", rt."id", am."id"
FROM "room_types" rt
CROSS JOIN LATERAL unnest(rt."amenities") AS a(val)
JOIN "amenities" am
	ON am."hotel_id" = rt."hotel_id"
	AND am."slug" = COALESCE(NULLIF(trim(BOTH '-' FROM regexp_replace(regexp_replace(lower(trim(a.val)), '&', ' and ', 'g'), '[^a-z0-9]+', '-', 'g')), ''), 'amenity')
WHERE trim(a.val) <> ''
ON CONFLICT ("room_type_id", "amenity_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "room_types" DROP COLUMN "amenities";