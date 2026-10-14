ALTER TYPE "public"."hall_booking_status" ADD VALUE 'checked_in' BEFORE 'completed';--> statement-breakpoint
ALTER TYPE "public"."hall_booking_status" ADD VALUE 'checked_out' BEFORE 'completed';--> statement-breakpoint
CREATE UNIQUE INDEX "folio_charges_one_live_hall_overtime_idx" ON "folio_charges" USING btree ("folio_id") WHERE source = 'hall_overtime' and voided_at is null;