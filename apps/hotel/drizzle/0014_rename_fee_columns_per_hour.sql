ALTER TABLE "hotels" RENAME COLUMN "late_checkout_fee_centavos" TO "late_checkout_fee_per_hour_centavos";--> statement-breakpoint
ALTER TABLE "hotels" RENAME COLUMN "early_check_in_fee_centavos" TO "early_check_in_fee_per_hour_centavos";
