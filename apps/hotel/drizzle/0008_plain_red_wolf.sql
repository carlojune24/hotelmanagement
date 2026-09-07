CREATE TYPE "public"."order_status" AS ENUM('pending_payment', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."hall_booking_status" AS ENUM('pending_payment', 'confirmed', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "function_halls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capacity" integer NOT NULL,
	"base_hours" integer NOT NULL,
	"base_price_centavos" bigint NOT NULL,
	"extra_hour_fee_centavos" bigint NOT NULL,
	"included_services" text[] DEFAULT '{}' NOT NULL,
	"supported_event_types" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'pending_payment' NOT NULL,
	"currency" text DEFAULT 'PHP' NOT NULL,
	"subtotal_centavos" bigint NOT NULL,
	"fees_centavos" bigint NOT NULL,
	"vat_centavos" bigint NOT NULL,
	"total_centavos" bigint NOT NULL,
	"access_token" text NOT NULL,
	"paymongo_checkout_session_id" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hall_booking_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hall_booking_id" uuid NOT NULL,
	"from_status" "hall_booking_status",
	"to_status" "hall_booking_status" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hall_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"function_hall_id" uuid NOT NULL,
	"event_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"event_type" text NOT NULL,
	"guest_count" integer NOT NULL,
	"status" "hall_booking_status" DEFAULT 'pending_payment' NOT NULL,
	"currency" text DEFAULT 'PHP' NOT NULL,
	"subtotal_centavos" bigint NOT NULL,
	"fees_centavos" bigint NOT NULL,
	"vat_centavos" bigint NOT NULL,
	"total_centavos" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text NOT NULL,
	"guest_display_name" text NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"moderation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"moderated_at" timestamp with time zone,
	"moderated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "function_halls" ADD CONSTRAINT "function_halls_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_booking_status_history" ADD CONSTRAINT "hall_booking_status_history_hall_booking_id_hall_bookings_id_fk" FOREIGN KEY ("hall_booking_id") REFERENCES "public"."hall_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_bookings" ADD CONSTRAINT "hall_bookings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_bookings" ADD CONSTRAINT "hall_bookings_function_hall_id_function_halls_id_fk" FOREIGN KEY ("function_hall_id") REFERENCES "public"."function_halls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "function_halls_hotel_idx" ON "function_halls" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order_idx" ON "order_status_history" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_hotel_idx" ON "orders" USING btree ("hotel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_access_token_idx" ON "orders" USING btree ("access_token");--> statement-breakpoint
CREATE INDEX "hall_booking_status_history_hall_booking_idx" ON "hall_booking_status_history" USING btree ("hall_booking_id");--> statement-breakpoint
CREATE INDEX "hall_bookings_order_idx" ON "hall_bookings" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "hall_bookings_hall_idx" ON "hall_bookings" USING btree ("function_hall_id","event_date");--> statement-breakpoint
CREATE INDEX "reviews_hotel_idx" ON "reviews" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "reviews_hotel_status_idx" ON "reviews" USING btree ("hotel_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_booking_idx" ON "reviews" USING btree ("booking_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_order_idx" ON "bookings" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);