ALTER TABLE "bookings" DROP CONSTRAINT "bookings_guest_id_guests_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_booking_id_bookings_id_fk";
--> statement-breakpoint
DROP INDEX "bookings_access_token_idx";--> statement-breakpoint
DROP INDEX "payments_booking_idx";--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "order_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "order_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "guest_id";--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "access_token";--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "paymongo_checkout_session_id";--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "cancelled_at";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "booking_id";