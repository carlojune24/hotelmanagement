ALTER TABLE "hotels" ADD COLUMN "custom_domain" text;--> statement-breakpoint
ALTER TABLE "hotels" ADD CONSTRAINT "hotels_custom_domain_unique" UNIQUE("custom_domain");