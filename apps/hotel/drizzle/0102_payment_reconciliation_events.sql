CREATE TABLE "payment_reconciliation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"event_type" text NOT NULL,
	"scope" text NOT NULL,
	"order_id" uuid,
	"dining_order_id" uuid,
	"attempt_id" uuid,
	"payment_row_id" uuid,
	"checkout_session_id" text,
	"paymongo_payment_id" text,
	"payment_intent_id" text,
	"amount_centavos" bigint NOT NULL,
	"expected_amount_centavos" bigint,
	"paymongo_paid_at" timestamp with time zone,
	"attempt_started_at" timestamp with time zone,
	"trigger" text NOT NULL,
	"order_status_before" text,
	"order_status_after" text,
	"checks" integer,
	"error" text,
	"details" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"prev_hash" text,
	"row_hash" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_recon_events_seq_uq" ON "payment_reconciliation_events" USING btree ("hotel_id","seq");--> statement-breakpoint
CREATE INDEX "payment_recon_events_when_idx" ON "payment_reconciliation_events" USING btree ("hotel_id","occurred_at");--> statement-breakpoint
CREATE INDEX "payment_recon_events_payment_idx" ON "payment_reconciliation_events" USING btree ("paymongo_payment_id");
--> statement-breakpoint
-- Append-only: the money trail can be added to, never changed or removed (see schema/payment-recon-events.ts).
CREATE FUNCTION "payment_reconciliation_events_append_only"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'payment_reconciliation_events is append-only (% is not allowed)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "payment_reconciliation_events_no_update_delete" BEFORE UPDATE OR DELETE ON "payment_reconciliation_events" FOR EACH ROW EXECUTE FUNCTION "payment_reconciliation_events_append_only"();
--> statement-breakpoint
CREATE TRIGGER "payment_reconciliation_events_no_truncate" BEFORE TRUNCATE ON "payment_reconciliation_events" FOR EACH STATEMENT EXECUTE FUNCTION "payment_reconciliation_events_append_only"();
