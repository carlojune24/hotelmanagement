ALTER TABLE "cancellation_policies" ADD COLUMN "grace_hours_after_payment" integer;--> statement-breakpoint
ALTER TABLE "cancellation_policies" ADD COLUMN "grace_fee_bps" integer;