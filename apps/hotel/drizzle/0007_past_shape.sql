CREATE TYPE "public"."booking_status" AS ENUM('pending_payment', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'failed');--> statement-breakpoint
CREATE TABLE "booking_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"room_type_id" uuid NOT NULL,
	"rate_plan_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"from_status" "booking_status",
	"to_status" "booking_status" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"occupancy" integer NOT NULL,
	"status" "booking_status" DEFAULT 'pending_payment' NOT NULL,
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
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"special_requests" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"provider" text DEFAULT 'paymongo' NOT NULL,
	"paymongo_checkout_session_id" text,
	"paymongo_payment_id" text,
	"paymongo_event_id" text,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"currency" text DEFAULT 'PHP' NOT NULL,
	"raw_payload" jsonb,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_rooms" ADD CONSTRAINT "booking_rooms_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_rooms" ADD CONSTRAINT "booking_rooms_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_rooms" ADD CONSTRAINT "booking_rooms_rate_plan_id_rate_plans_id_fk" FOREIGN KEY ("rate_plan_id") REFERENCES "public"."rate_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_rooms_booking_idx" ON "booking_rooms" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_rooms_room_type_idx" ON "booking_rooms" USING btree ("room_type_id");--> statement-breakpoint
CREATE INDEX "booking_status_history_booking_idx" ON "booking_status_history" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "bookings_hotel_idx" ON "bookings" USING btree ("hotel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_access_token_idx" ON "bookings" USING btree ("access_token");--> statement-breakpoint
CREATE INDEX "guests_hotel_idx" ON "guests" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "guests_hotel_email_idx" ON "guests" USING btree ("hotel_id","email");--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_paymongo_event_idx" ON "payments" USING btree ("paymongo_event_id");