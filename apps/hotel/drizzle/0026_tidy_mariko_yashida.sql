ALTER TABLE "payments" ADD COLUMN "refunds_payment_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "paymongo_refund_id" text;--> statement-breakpoint
CREATE INDEX "payments_refunds_payment_idx" ON "payments" USING btree ("refunds_payment_id");--> statement-breakpoint
CREATE INDEX "payments_paymongo_refund_idx" ON "payments" USING btree ("paymongo_refund_id");