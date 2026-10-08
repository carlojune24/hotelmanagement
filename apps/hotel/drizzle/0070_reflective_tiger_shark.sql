ALTER TYPE "public"."dining_order_status" ADD VALUE 'pending_payment' BEFORE 'new';--> statement-breakpoint
ALTER TYPE "public"."dining_payment_status" ADD VALUE 'refunded';--> statement-breakpoint
ALTER TYPE "public"."email_type" ADD VALUE 'dining_order';--> statement-breakpoint
ALTER TYPE "public"."email_type" ADD VALUE 'dining_order_ready';--> statement-breakpoint
CREATE TABLE "dining_order_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"author_user_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"method" text,
	"amount_centavos" bigint NOT NULL,
	"paymongo_checkout_session_id" text,
	"paymongo_payment_id" text,
	"paymongo_event_id" text,
	"reference_no" text,
	"proof_url" text,
	"note" text,
	"cash_movement_id" uuid,
	"raw_payload" jsonb,
	"created_by_user_id" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "online_orders_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "online_payment" text DEFAULT 'online_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "order_open" text;--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "order_close" text;--> statement-breakpoint
ALTER TABLE "dining_items" ADD COLUMN "prep_minutes" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "pickup_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "pay_mode" text;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "cancel_request_note" text;--> statement-breakpoint
ALTER TABLE "dining_order_messages" ADD CONSTRAINT "dining_order_messages_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_order_messages" ADD CONSTRAINT "dining_order_messages_order_id_dining_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."dining_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_order_messages" ADD CONSTRAINT "dining_order_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_payments" ADD CONSTRAINT "dining_payments_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_payments" ADD CONSTRAINT "dining_payments_order_id_dining_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."dining_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_payments" ADD CONSTRAINT "dining_payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dining_order_messages_order_idx" ON "dining_order_messages" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "dining_payments_order_idx" ON "dining_payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dining_payments_event_uq" ON "dining_payments" USING btree ("paymongo_event_id") WHERE paymongo_event_id is not null;