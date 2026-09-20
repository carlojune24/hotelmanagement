ALTER TABLE "cancellation_policies" ADD COLUMN "downpayment_bps" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "amount_due_now_centavos" bigint;