CREATE TYPE "public"."expense_source" AS ENUM('hotel', 'dining');--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "source" "expense_source" DEFAULT 'hotel' NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "source" "expense_source" DEFAULT 'hotel' NOT NULL;