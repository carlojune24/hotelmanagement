ALTER TABLE "dining_orders" ADD COLUMN "folio_charge_id" uuid;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "room_label" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "dining_centavos" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD COLUMN "dining_order_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "dining_centavos" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "folio_charges_one_live_per_dining_order_idx" ON "folio_charges" USING btree ("dining_order_id") WHERE dining_order_id is not null and voided_at is null;