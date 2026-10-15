ALTER TABLE "hotels" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "hotels" SET "sort_order" = r.rn FROM (SELECT "id", row_number() OVER (ORDER BY "name") AS rn FROM "hotels") r WHERE "hotels"."id" = r."id";
