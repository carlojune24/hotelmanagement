ALTER TABLE "dining_orders" ADD COLUMN "discount_kind" text;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "discount_bps" integer;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "discount_centavos" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "discount_vat_removed_centavos" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "discount_claimants" jsonb;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "discount_diners" integer;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "discount_vat_before_centavos" bigint;