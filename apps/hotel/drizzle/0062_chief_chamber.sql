CREATE TABLE "dining_addon_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"dining_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"min_choices" integer DEFAULT 0 NOT NULL,
	"max_choices" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_centavos" integer DEFAULT 0 NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining_menu_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"dining_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining_menu_item_addon_groups" (
	"menu_item_id" uuid NOT NULL,
	"addon_group_id" uuid NOT NULL,
	CONSTRAINT "dining_menu_item_addon_groups_menu_item_id_addon_group_id_pk" PRIMARY KEY("menu_item_id","addon_group_id")
);
--> statement-breakpoint
CREATE TABLE "dining_menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"dining_item_id" uuid NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"price_centavos" integer NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"station" text,
	"is_available" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "dining_addon_groups" ADD CONSTRAINT "dining_addon_groups_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_addon_groups" ADD CONSTRAINT "dining_addon_groups_dining_item_id_dining_items_id_fk" FOREIGN KEY ("dining_item_id") REFERENCES "public"."dining_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_addons" ADD CONSTRAINT "dining_addons_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_addons" ADD CONSTRAINT "dining_addons_group_id_dining_addon_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."dining_addon_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_menu_categories" ADD CONSTRAINT "dining_menu_categories_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_menu_categories" ADD CONSTRAINT "dining_menu_categories_dining_item_id_dining_items_id_fk" FOREIGN KEY ("dining_item_id") REFERENCES "public"."dining_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_menu_item_addon_groups" ADD CONSTRAINT "dining_menu_item_addon_groups_menu_item_id_dining_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."dining_menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_menu_item_addon_groups" ADD CONSTRAINT "dining_menu_item_addon_groups_addon_group_id_dining_addon_groups_id_fk" FOREIGN KEY ("addon_group_id") REFERENCES "public"."dining_addon_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_menu_items" ADD CONSTRAINT "dining_menu_items_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_menu_items" ADD CONSTRAINT "dining_menu_items_dining_item_id_dining_items_id_fk" FOREIGN KEY ("dining_item_id") REFERENCES "public"."dining_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_menu_items" ADD CONSTRAINT "dining_menu_items_category_id_dining_menu_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."dining_menu_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dining_addon_groups_venue_idx" ON "dining_addon_groups" USING btree ("hotel_id","dining_item_id");--> statement-breakpoint
CREATE INDEX "dining_addons_group_idx" ON "dining_addons" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "dining_menu_categories_venue_idx" ON "dining_menu_categories" USING btree ("hotel_id","dining_item_id");--> statement-breakpoint
CREATE INDEX "dining_menu_items_venue_idx" ON "dining_menu_items" USING btree ("hotel_id","dining_item_id");--> statement-breakpoint
CREATE INDEX "dining_menu_items_category_idx" ON "dining_menu_items" USING btree ("category_id");