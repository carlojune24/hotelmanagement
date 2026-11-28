ALTER TABLE "expenses" ADD COLUMN "attachment_urls" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
UPDATE "expenses" SET "attachment_urls" = ARRAY["attachment_url"] WHERE "attachment_url" IS NOT NULL;
