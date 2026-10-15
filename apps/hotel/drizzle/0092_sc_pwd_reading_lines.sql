ALTER TABLE "z_readings" ADD COLUMN "sc_pwd_vat_removed_centavos" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "z_readings" ADD COLUMN "sc_pwd_credit_owed_centavos" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "z_readings" ADD COLUMN "net_method" integer DEFAULT 1 NOT NULL;