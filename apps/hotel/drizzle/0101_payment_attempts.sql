ALTER TYPE "public"."email_type" ADD VALUE 'payment_tracking';--> statement-breakpoint
ALTER TYPE "public"."email_type" ADD VALUE 'payment_delayed';--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"order_id" uuid,
	"dining_order_id" uuid,
	"checkout_session_id" text NOT NULL,
	"amount_centavos" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"paymongo_payment_id" text,
	"payment_intent_id" text,
	"paid_at" timestamp with time zone,
	"checks" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_session_status" text,
	"last_error" text,
	"tracking_email_at" timestamp with time zone,
	"delayed_email_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_dining_order_id_dining_orders_id_fk" FOREIGN KEY ("dining_order_id") REFERENCES "public"."dining_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_session_uq" ON "payment_attempts" USING btree ("hotel_id","checkout_session_id");--> statement-breakpoint
CREATE INDEX "payment_attempts_due_idx" ON "payment_attempts" USING btree ("status","next_check_at");--> statement-breakpoint
CREATE INDEX "payment_attempts_order_idx" ON "payment_attempts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_attempts_dining_idx" ON "payment_attempts" USING btree ("dining_order_id");--> statement-breakpoint
CREATE INDEX "payment_attempts_payment_idx" ON "payment_attempts" USING btree ("paymongo_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dining_payments_payment_paid_uq" ON "dining_payments" USING btree ("paymongo_payment_id") WHERE status = 'paid' and kind = 'payment' and paymongo_payment_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_paymongo_payment_paid_uq" ON "payments" USING btree ("paymongo_payment_id") WHERE status = 'paid' and purpose <> 'refund' and paymongo_payment_id is not null;--> statement-breakpoint
-- Backfill: every booking still waiting for payment (and any cancelled in the last week, where a late payment would
-- need a refund) gets an attempt, so the verifier checks it with PayMongo straight away instead of leaving a paid-but-
-- unconfirmed booking stuck.
INSERT INTO "payment_attempts" ("hotel_id", "scope", "order_id", "checkout_session_id", "amount_centavos", "status")
SELECT o."hotel_id", 'room', o."id", o."paymongo_checkout_session_id", COALESCE(o."amount_due_now_centavos", o."total_centavos"), 'open'
FROM "orders" o
WHERE o."paymongo_checkout_session_id" IS NOT NULL
  AND (o."status" = 'pending_payment' OR (o."status" = 'cancelled' AND o."cancelled_at" > now() - interval '7 days'))
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "payment_attempts" ("hotel_id", "scope", "dining_order_id", "checkout_session_id", "amount_centavos", "status")
SELECT dp."hotel_id", 'dining', dp."order_id", dp."paymongo_checkout_session_id", dp."amount_centavos"::int, 'open'
FROM "dining_payments" dp
WHERE dp."kind" = 'payment' AND dp."status" = 'pending' AND dp."paymongo_checkout_session_id" IS NOT NULL
ON CONFLICT DO NOTHING;
