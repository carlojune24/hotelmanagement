ALTER TYPE "public"."stock_movement_type" ADD VALUE 'order';--> statement-breakpoint
ALTER TYPE "public"."stock_movement_type" ADD VALUE 'order_reverse';--> statement-breakpoint
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
ALTER TABLE "stock_movements" ADD COLUMN "dining_order_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_recipe_lines" ADD CONSTRAINT "stock_recipe_lines_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_recipe_lines" ADD CONSTRAINT "stock_recipe_lines_menu_item_id_dining_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."dining_menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_recipe_lines" ADD CONSTRAINT "stock_recipe_lines_addon_id_dining_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."dining_addons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_recipe_lines" ADD CONSTRAINT "stock_recipe_lines_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_recipe_lines_menu_item_uq" ON "stock_recipe_lines" USING btree ("menu_item_id","stock_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_recipe_lines_addon_uq" ON "stock_recipe_lines" USING btree ("addon_id","stock_item_id");--> statement-breakpoint
CREATE INDEX "stock_recipe_lines_hotel_idx" ON "stock_recipe_lines" USING btree ("hotel_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_dining_order_id_dining_orders_id_fk" FOREIGN KEY ("dining_order_id") REFERENCES "public"."dining_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_dining_order_idx" ON "stock_movements" USING btree ("dining_order_id");