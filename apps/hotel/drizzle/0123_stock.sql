CREATE TYPE "public"."stock_count_status" AS ENUM('open', 'finished');--> statement-breakpoint
CREATE TYPE "public"."stock_department" AS ENUM('dining', 'front_desk', 'housekeeping');--> statement-breakpoint
CREATE TYPE "public"."stock_kind" AS ENUM('consumable', 'reusable');--> statement-breakpoint
CREATE TYPE "public"."stock_kit_basis" AS ENUM('room', 'guest');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_type" AS ENUM('restock', 'adjust_in', 'waste', 'adjust_out', 'order', 'order_reverse', 'checkin_kit');--> statement-breakpoint
CREATE TYPE "public"."stock_unit" AS ENUM('g', 'ml', 'pcs');--> statement-breakpoint
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
CREATE TABLE "stock_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"counted_milli" bigint,
	"reason" text,
	"expected_milli" bigint,
	"variance_milli" bigint
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"department" "stock_department",
	"status" "stock_count_status" DEFAULT 'open' NOT NULL,
	"note" text,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_by" uuid,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
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
	"dining_order_id" uuid,
	"booking_id" uuid,
	"count_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_recipe_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"menu_item_id" uuid,
	"addon_id" uuid,
	"stock_item_id" uuid NOT NULL,
	"qty_milli" bigint NOT NULL,
	CONSTRAINT "stock_recipe_lines_one_owner" CHECK (("stock_recipe_lines"."menu_item_id" IS NULL) <> ("stock_recipe_lines"."addon_id" IS NULL)),
	CONSTRAINT "stock_recipe_lines_qty_positive" CHECK ("stock_recipe_lines"."qty_milli" > 0)
);
--> statement-breakpoint
ALTER TABLE "stock_checkin_kit_lines" ADD CONSTRAINT "stock_checkin_kit_lines_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_checkin_kit_lines" ADD CONSTRAINT "stock_checkin_kit_lines_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_checkin_kit_lines" ADD CONSTRAINT "stock_checkin_kit_lines_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_stock_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_item_id_stock_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_finished_by_users_id_fk" FOREIGN KEY ("finished_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_stock_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_consumed_from_id_stock_movements_id_fk" FOREIGN KEY ("consumed_from_id") REFERENCES "public"."stock_movements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_dining_order_id_dining_orders_id_fk" FOREIGN KEY ("dining_order_id") REFERENCES "public"."dining_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_count_id_stock_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_counts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_recipe_lines" ADD CONSTRAINT "stock_recipe_lines_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_recipe_lines" ADD CONSTRAINT "stock_recipe_lines_menu_item_id_dining_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."dining_menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_recipe_lines" ADD CONSTRAINT "stock_recipe_lines_addon_id_dining_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."dining_addons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_recipe_lines" ADD CONSTRAINT "stock_recipe_lines_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_checkin_kit_lines_uq" ON "stock_checkin_kit_lines" USING btree ("room_type_id","stock_item_id");--> statement-breakpoint
CREATE INDEX "stock_checkin_kit_lines_hotel_idx" ON "stock_checkin_kit_lines" USING btree ("hotel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_lines_uq" ON "stock_count_lines" USING btree ("count_id","item_id");--> statement-breakpoint
CREATE INDEX "stock_counts_hotel_idx" ON "stock_counts" USING btree ("hotel_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_counts_one_open_uq" ON "stock_counts" USING btree ("hotel_id") WHERE "stock_counts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "stock_items_hotel_idx" ON "stock_items" USING btree ("hotel_id","department");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_items_hotel_name_uq" ON "stock_items" USING btree ("hotel_id",lower("name")) WHERE "stock_items"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "stock_movements_item_idx" ON "stock_movements" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_hotel_idx" ON "stock_movements" USING btree ("hotel_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_dining_order_idx" ON "stock_movements" USING btree ("dining_order_id");--> statement-breakpoint
CREATE INDEX "stock_movements_booking_idx" ON "stock_movements" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "stock_movements_open_batch_idx" ON "stock_movements" USING btree ("item_id","created_at") WHERE "stock_movements"."qty_remaining_milli" > 0;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_recipe_lines_menu_item_uq" ON "stock_recipe_lines" USING btree ("menu_item_id","stock_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_recipe_lines_addon_uq" ON "stock_recipe_lines" USING btree ("addon_id","stock_item_id");--> statement-breakpoint
CREATE INDEX "stock_recipe_lines_hotel_idx" ON "stock_recipe_lines" USING btree ("hotel_id");--> statement-breakpoint
-- Capability backfill: new hotels get these from ROLE_CAPS (authz.ts); existing hotels' seeded
-- roles need the rows inserted. hotel_admin already holds '*'.
INSERT INTO "role_permissions" ("role_id", "capability")
SELECT r."id", c."cap"
FROM "roles" r
CROSS JOIN (VALUES ('inventory:read'), ('inventory:write')) AS c("cap")
WHERE r."slug" IN ('front_desk', 'housekeeping', 'dining') AND r."deleted_at" IS NULL
ON CONFLICT DO NOTHING;
