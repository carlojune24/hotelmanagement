CREATE TABLE "shift_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_rest_day" boolean DEFAULT false NOT NULL,
	"start_time" time,
	"end_time" time,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"tag" text DEFAULT 'neutral' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_templates_hotel_idx" ON "shift_templates" USING btree ("hotel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_templates_hotel_name_idx" ON "shift_templates" USING btree ("hotel_id","name") WHERE deleted_at is null;