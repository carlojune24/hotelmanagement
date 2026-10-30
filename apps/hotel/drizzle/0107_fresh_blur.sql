ALTER TABLE "orders" ADD COLUMN "ota_name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ota_reference" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ota_gross_centavos" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ota_commission_centavos" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ota_net_centavos" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_ota_reference_idx" ON "orders" USING btree ("hotel_id","ota_name","ota_reference") WHERE "orders"."ota_name" is not null;