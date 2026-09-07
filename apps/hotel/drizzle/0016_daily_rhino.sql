CREATE TYPE "public"."folio_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "amenity_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"price_centavos" bigint NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "folio_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folio_id" uuid NOT NULL,
	"amenity_item_id" uuid,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_centavos" bigint NOT NULL,
	"tax_centavos" bigint DEFAULT 0 NOT NULL,
	"total_centavos" bigint NOT NULL,
	"added_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"status" "folio_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folios_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
ALTER TABLE "amenity_items" ADD CONSTRAINT "amenity_items_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_folio_id_folios_id_fk" FOREIGN KEY ("folio_id") REFERENCES "public"."folios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_amenity_item_id_amenity_items_id_fk" FOREIGN KEY ("amenity_item_id") REFERENCES "public"."amenity_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folios" ADD CONSTRAINT "folios_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folios" ADD CONSTRAINT "folios_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "amenity_items_hotel_idx" ON "amenity_items" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "folio_charges_folio_idx" ON "folio_charges" USING btree ("folio_id");--> statement-breakpoint
CREATE INDEX "folios_hotel_idx" ON "folios" USING btree ("hotel_id");