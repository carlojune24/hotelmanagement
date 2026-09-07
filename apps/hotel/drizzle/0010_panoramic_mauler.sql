CREATE TABLE "dining_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"photo_url" text,
	"operating_hours" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "dining_items" ADD CONSTRAINT "dining_items_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dining_items_hotel_idx" ON "dining_items" USING btree ("hotel_id");