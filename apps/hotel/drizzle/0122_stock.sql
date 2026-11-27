CREATE TYPE "public"."stock_department" AS ENUM('dining', 'front_desk', 'housekeeping');--> statement-breakpoint
CREATE TYPE "public"."stock_kind" AS ENUM('consumable', 'reusable');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_type" AS ENUM('restock', 'adjust_in', 'waste', 'adjust_out');--> statement-breakpoint
CREATE TYPE "public"."stock_unit" AS ENUM('g', 'ml', 'pcs');--> statement-breakpoint
CREATE TABLE "stock_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"department" "stock_department" NOT NULL,
	"kind" "stock_kind" DEFAULT 'consumable' NOT NULL,
	"unit" "stock_unit" NOT NULL,
	"reorder_level_milli" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"type" "stock_movement_type" NOT NULL,
	"qty_milli" bigint NOT NULL,
	"qty_remaining_milli" bigint,
	"consumed_from_id" uuid,
	"expires_on" date,
	"pack_count" integer,
	"pack_bonus" integer,
	"pack_size_milli" bigint,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_stock_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_consumed_from_id_stock_movements_id_fk" FOREIGN KEY ("consumed_from_id") REFERENCES "public"."stock_movements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_items_hotel_idx" ON "stock_items" USING btree ("hotel_id","department");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_items_hotel_name_uq" ON "stock_items" USING btree ("hotel_id",lower("name")) WHERE "stock_items"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "stock_movements_item_idx" ON "stock_movements" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_hotel_idx" ON "stock_movements" USING btree ("hotel_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_open_batch_idx" ON "stock_movements" USING btree ("item_id","created_at") WHERE "stock_movements"."qty_remaining_milli" > 0;--> statement-breakpoint
-- Capability backfill: new hotels get these from ROLE_CAPS (authz.ts); existing hotels' seeded
-- roles need the rows inserted. hotel_admin already holds '*'.
INSERT INTO "role_permissions" ("role_id", "capability")
SELECT r."id", c."cap"
FROM "roles" r
CROSS JOIN (VALUES ('inventory:read'), ('inventory:write')) AS c("cap")
WHERE r."slug" IN ('front_desk', 'housekeeping', 'dining') AND r."deleted_at" IS NULL
ON CONFLICT DO NOTHING;
