ALTER TABLE "dining_items" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "tagline" text;--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "highlights" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "photos" jsonb DEFAULT '[]'::jsonb NOT NULL;