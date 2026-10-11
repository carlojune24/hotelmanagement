ALTER TABLE "dining_items" ADD COLUMN "delivery_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "delivery_fee_centavos" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "fulfilment" text DEFAULT 'pickup' NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "delivery_fee_centavos" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "delivery_address" text;