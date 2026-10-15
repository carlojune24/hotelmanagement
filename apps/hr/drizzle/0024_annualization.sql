ALTER TABLE "employees" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "prev_employer_year" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "prev_employer_name" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "prev_employer_taxable_centavos" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "prev_employer_withheld_centavos" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_items" ADD COLUMN "taxable" boolean DEFAULT true NOT NULL;