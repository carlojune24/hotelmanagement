CREATE TABLE "paymongo_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"paymongo_id" text NOT NULL,
	"kind" text NOT NULL,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"gross_centavos" integer NOT NULL,
	"fee_centavos" integer DEFAULT 0 NOT NULL,
	"net_centavos" integer NOT NULL,
	"currency" text DEFAULT 'PHP' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone,
	"credited_at" timestamp with time zone,
	"payout_id" text,
	"balance_transaction_id" text,
	"source_type" text,
	"reference" text,
	"description" text,
	"payment_id" text,
	"order_id" uuid,
	"dining_order_id" uuid,
	"bank_name" text,
	"account_last4" text,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paymongo_sync_state" (
	"hotel_id" uuid PRIMARY KEY NOT NULL,
	"last_synced_at" timestamp with time zone,
	"backfilled_at" timestamp with time zone,
	"last_error" text,
	"wallet_supported" boolean DEFAULT false NOT NULL,
	"wallet_balance" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paymongo_ledger" ADD CONSTRAINT "paymongo_ledger_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paymongo_ledger" ADD CONSTRAINT "paymongo_ledger_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paymongo_ledger" ADD CONSTRAINT "paymongo_ledger_dining_order_id_dining_orders_id_fk" FOREIGN KEY ("dining_order_id") REFERENCES "public"."dining_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paymongo_sync_state" ADD CONSTRAINT "paymongo_sync_state_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paymongo_ledger_hotel_pm_uq" ON "paymongo_ledger" USING btree ("hotel_id","paymongo_id");--> statement-breakpoint
CREATE INDEX "paymongo_ledger_hotel_occurred_idx" ON "paymongo_ledger" USING btree ("hotel_id","occurred_at");--> statement-breakpoint
CREATE INDEX "paymongo_ledger_hotel_kind_idx" ON "paymongo_ledger" USING btree ("hotel_id","kind","status");--> statement-breakpoint
CREATE INDEX "paymongo_ledger_payment_idx" ON "paymongo_ledger" USING btree ("hotel_id","payment_id");