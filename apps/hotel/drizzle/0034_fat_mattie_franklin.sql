ALTER TABLE "standalone_sales" ADD COLUMN "tendered_centavos" bigint;--> statement-breakpoint
ALTER TABLE "standalone_sales" ADD COLUMN "change_centavos" bigint DEFAULT 0 NOT NULL;