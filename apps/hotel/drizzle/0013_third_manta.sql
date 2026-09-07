ALTER TABLE "hotels" ADD COLUMN "late_checkout_fee_centavos" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hotels" ADD COLUMN "early_check_in_fee_centavos" bigint DEFAULT 0 NOT NULL;