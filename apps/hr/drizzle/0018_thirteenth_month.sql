ALTER TABLE "employees" ADD COLUMN "thirteenth_month_covered" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "thirteenth_month_note" text;--> statement-breakpoint
ALTER TABLE "separation_items" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "separation_items" ADD COLUMN "source_year" integer;