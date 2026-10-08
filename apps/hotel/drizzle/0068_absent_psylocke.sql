CREATE TYPE "public"."dining_order_status" AS ENUM('new', 'accepted', 'preparing', 'ready', 'served', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."dining_order_type" AS ENUM('dine_in', 'takeaway', 'pre_order');--> statement-breakpoint
CREATE TYPE "public"."dining_payment_status" AS ENUM('unpaid', 'paid', 'room_charged');--> statement-breakpoint
CREATE TABLE "dining_order_item_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"addon_id" uuid,
	"name" text NOT NULL,
	"price_centavos" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"menu_item_id" uuid,
	"name" text NOT NULL,
	"station_id" uuid,
	"station_name" text,
	"quantity" integer NOT NULL,
	"unit_price_centavos" bigint NOT NULL,
	"addons_centavos" bigint DEFAULT 0 NOT NULL,
	"line_total_centavos" bigint NOT NULL,
	"vat_centavos" bigint DEFAULT 0 NOT NULL,
	"remarks" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"dining_item_id" uuid NOT NULL,
	"code" text NOT NULL,
	"access_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" "dining_order_status" DEFAULT 'new' NOT NULL,
	"order_type" "dining_order_type" DEFAULT 'dine_in' NOT NULL,
	"payment_status" "dining_payment_status" DEFAULT 'unpaid' NOT NULL,
	"table_id" uuid,
	"table_label" text,
	"reservation_id" uuid,
	"booking_id" uuid,
	"guest_name" text,
	"guest_phone" text,
	"guest_email" text,
	"remarks" text,
	"source" text DEFAULT 'staff' NOT NULL,
	"total_centavos" bigint NOT NULL,
	"vat_centavos" bigint DEFAULT 0 NOT NULL,
	"business_date" date,
	"payment_method" "payment_method",
	"tendered_centavos" bigint,
	"change_centavos" bigint DEFAULT 0 NOT NULL,
	"cash_account_id" uuid,
	"shift_id" uuid,
	"cash_movement_id" uuid,
	"paid_at" timestamp with time zone,
	"paid_by_user_id" uuid,
	"created_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"served_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dining_order_item_addons" ADD CONSTRAINT "dining_order_item_addons_order_item_id_dining_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."dining_order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_order_item_addons" ADD CONSTRAINT "dining_order_item_addons_addon_id_dining_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."dining_addons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_order_items" ADD CONSTRAINT "dining_order_items_order_id_dining_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."dining_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_order_items" ADD CONSTRAINT "dining_order_items_menu_item_id_dining_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."dining_menu_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_order_items" ADD CONSTRAINT "dining_order_items_station_id_dining_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."dining_stations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD CONSTRAINT "dining_orders_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD CONSTRAINT "dining_orders_dining_item_id_dining_items_id_fk" FOREIGN KEY ("dining_item_id") REFERENCES "public"."dining_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD CONSTRAINT "dining_orders_table_id_dining_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dining_tables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD CONSTRAINT "dining_orders_reservation_id_dining_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."dining_reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD CONSTRAINT "dining_orders_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD CONSTRAINT "dining_orders_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD CONSTRAINT "dining_orders_shift_id_cashier_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."cashier_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD CONSTRAINT "dining_orders_paid_by_user_id_users_id_fk" FOREIGN KEY ("paid_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD CONSTRAINT "dining_orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dining_order_item_addons_item_idx" ON "dining_order_item_addons" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "dining_order_items_order_idx" ON "dining_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "dining_order_items_menu_idx" ON "dining_order_items" USING btree ("menu_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dining_orders_code_uq" ON "dining_orders" USING btree ("hotel_id","code");--> statement-breakpoint
CREATE INDEX "dining_orders_hotel_status_idx" ON "dining_orders" USING btree ("hotel_id","status");--> statement-breakpoint
CREATE INDEX "dining_orders_hotel_date_idx" ON "dining_orders" USING btree ("hotel_id","business_date");--> statement-breakpoint
CREATE INDEX "dining_orders_venue_created_idx" ON "dining_orders" USING btree ("hotel_id","dining_item_id","created_at");