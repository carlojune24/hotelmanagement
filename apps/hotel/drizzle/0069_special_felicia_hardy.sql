ALTER TABLE "dining_order_items" ADD COLUMN "taxable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "dining_order_id" uuid;--> statement-breakpoint
CREATE INDEX "documents_dining_order_idx" ON "documents" USING btree ("dining_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_one_invoice_per_dining_order_idx" ON "documents" USING btree ("dining_order_id") WHERE type = 'invoice' and status = 'issued' and dining_order_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_one_or_per_dining_order_idx" ON "documents" USING btree ("dining_order_id") WHERE type = 'official_receipt' and status = 'issued' and dining_order_id is not null;