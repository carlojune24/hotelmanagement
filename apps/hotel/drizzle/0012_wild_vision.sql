ALTER TABLE "hotels" ADD COLUMN "check_in_time" time DEFAULT '14:00:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "hotels" ADD COLUMN "check_out_time" time DEFAULT '12:00:00' NOT NULL;