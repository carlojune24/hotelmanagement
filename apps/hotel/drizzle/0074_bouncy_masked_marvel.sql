CREATE TYPE "public"."dining_check_status" AS ENUM('open', 'closed');--> statement-breakpoint
ALTER TYPE "public"."dining_order_status" ADD VALUE 'pending_acceptance' BEFORE 'new';--> statement-breakpoint
CREATE TABLE "dining_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"dining_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining_table_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"dining_item_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"reservation_id" uuid,
	"status" "dining_check_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bill_requested_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" uuid,
	"force_cleared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dining_order_items" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dining_order_items" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "check_id" uuid;--> statement-breakpoint
ALTER TABLE "dining_stations" ADD COLUMN "target_minutes" integer;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD COLUMN "area_id" uuid;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD COLUMN "qr_token" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_areas" ADD CONSTRAINT "dining_areas_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_areas" ADD CONSTRAINT "dining_areas_dining_item_id_dining_items_id_fk" FOREIGN KEY ("dining_item_id") REFERENCES "public"."dining_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_table_checks" ADD CONSTRAINT "dining_table_checks_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_table_checks" ADD CONSTRAINT "dining_table_checks_dining_item_id_dining_items_id_fk" FOREIGN KEY ("dining_item_id") REFERENCES "public"."dining_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_table_checks" ADD CONSTRAINT "dining_table_checks_table_id_dining_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dining_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_table_checks" ADD CONSTRAINT "dining_table_checks_reservation_id_dining_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."dining_reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_table_checks" ADD CONSTRAINT "dining_table_checks_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dining_areas_venue_name_uq" ON "dining_areas" USING btree ("dining_item_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "dining_table_checks_open_uq" ON "dining_table_checks" USING btree ("table_id") WHERE "dining_table_checks"."status" = 'open';--> statement-breakpoint
CREATE INDEX "dining_table_checks_hotel_status_idx" ON "dining_table_checks" USING btree ("hotel_id","status");--> statement-breakpoint
ALTER TABLE "dining_orders" ADD CONSTRAINT "dining_orders_check_id_dining_table_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."dining_table_checks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_area_id_dining_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."dining_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dining_orders_check_idx" ON "dining_orders" USING btree ("check_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dining_tables_qr_token_uq" ON "dining_tables" USING btree ("qr_token");--> statement-breakpoint
-- Backfill: every distinct free-text table label becomes an area of its venue ("Main" when blank).
INSERT INTO "dining_areas" ("hotel_id", "dining_item_id", "name", "sort_order")
SELECT DISTINCT t."hotel_id", t."dining_item_id", COALESCE(NULLIF(btrim(t."area"), ''), 'Main'), 0
FROM "dining_tables" t;--> statement-breakpoint
UPDATE "dining_tables" t SET "area_id" = a."id"
FROM "dining_areas" a
WHERE a."dining_item_id" = t."dining_item_id" AND a."name" = COALESCE(NULLIF(btrim(t."area"), ''), 'Main');
