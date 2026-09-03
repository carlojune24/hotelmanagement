ALTER TABLE "rooms" ADD COLUMN "display_title" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "tagline" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "short_description" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "photos" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "room_types" DROP COLUMN "display_title";--> statement-breakpoint
ALTER TABLE "room_types" DROP COLUMN "tagline";--> statement-breakpoint
ALTER TABLE "room_types" DROP COLUMN "short_description";--> statement-breakpoint
ALTER TABLE "room_types" DROP COLUMN "photos";