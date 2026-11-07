CREATE TYPE "public"."cash_account_side" AS ENUM('hotel', 'dining', 'shared');--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD COLUMN "side" "cash_account_side" DEFAULT 'shared' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "side" "cash_account_side";--> statement-breakpoint
-- Starting tags: each hotel's dining drawer is Dining, its other drawers and petty cash are Hotel; bank, e-wallet and undeposited stay Shared.
UPDATE "cash_accounts" SET "side" = 'hotel' WHERE "kind" IN ('cash_drawer', 'petty_cash');--> statement-breakpoint
UPDATE "cash_accounts" SET "side" = 'dining' WHERE "id" IN (SELECT "dining_drawer_account_id" FROM "finance_settings" WHERE "dining_drawer_account_id" IS NOT NULL);
