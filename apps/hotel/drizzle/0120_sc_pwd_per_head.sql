ALTER TABLE "sc_pwd_discounts" ADD COLUMN "claimants" jsonb;--> statement-breakpoint
ALTER TABLE "sc_pwd_discounts" ADD COLUMN "guest_count" integer;--> statement-breakpoint
ALTER TABLE "sc_pwd_discounts" ADD COLUMN "lines" jsonb;--> statement-breakpoint
ALTER TABLE "sc_pwd_discounts" ADD COLUMN "promo_dropped_charge_id" uuid;