ALTER TABLE "public"."stock_counts" ALTER COLUMN "department" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "public"."stock_items" ALTER COLUMN "department" SET DATA TYPE text;--> statement-breakpoint
-- Departments are now Dining and Hotel: Front desk is renamed Hotel, and Housekeeping items
-- (linens, toiletries) join Hotel. Moved while the columns are plain text.
UPDATE "stock_items" SET "department" = 'hotel' WHERE "department" IN ('front_desk', 'housekeeping');--> statement-breakpoint
UPDATE "stock_counts" SET "department" = 'hotel' WHERE "department" IN ('front_desk', 'housekeeping');--> statement-breakpoint
DROP TYPE "public"."stock_department";--> statement-breakpoint
CREATE TYPE "public"."stock_department" AS ENUM('dining', 'hotel');--> statement-breakpoint
ALTER TABLE "public"."stock_counts" ALTER COLUMN "department" SET DATA TYPE "public"."stock_department" USING "department"::"public"."stock_department";--> statement-breakpoint
ALTER TABLE "public"."stock_items" ALTER COLUMN "department" SET DATA TYPE "public"."stock_department" USING "department"::"public"."stock_department";