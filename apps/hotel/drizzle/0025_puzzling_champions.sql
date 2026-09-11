CREATE TYPE "public"."guest_message_direction" AS ENUM('guest', 'staff');--> statement-breakpoint
CREATE TYPE "public"."guest_message_kind" AS ENUM('message', 'cancellation_request');--> statement-breakpoint
CREATE TYPE "public"."guest_message_status" AS ENUM('open', 'actioned', 'declined');--> statement-breakpoint
ALTER TYPE "public"."email_type" ADD VALUE 'guest_message_reply';--> statement-breakpoint
CREATE TABLE "guest_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"booking_id" uuid,
	"hall_booking_id" uuid,
	"direction" "guest_message_direction" NOT NULL,
	"kind" "guest_message_kind" DEFAULT 'message' NOT NULL,
	"status" "guest_message_status",
	"body" text NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"read_by_staff_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_messages" ADD CONSTRAINT "guest_messages_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_messages" ADD CONSTRAINT "guest_messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_messages" ADD CONSTRAINT "guest_messages_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_messages" ADD CONSTRAINT "guest_messages_hall_booking_id_hall_bookings_id_fk" FOREIGN KEY ("hall_booking_id") REFERENCES "public"."hall_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_messages" ADD CONSTRAINT "guest_messages_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_messages" ADD CONSTRAINT "guest_messages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_messages_hotel_idx" ON "guest_messages" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "guest_messages_order_idx" ON "guest_messages" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "guest_messages_booking_idx" ON "guest_messages" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "guest_messages_hall_booking_idx" ON "guest_messages" USING btree ("hall_booking_id");