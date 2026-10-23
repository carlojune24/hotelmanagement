ALTER TABLE "employee_contracts" ADD COLUMN "verify_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_contracts_verify_idx" ON "employee_contracts" USING btree ("verify_code");