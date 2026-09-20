CREATE TABLE "receivable_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receivable_id" uuid NOT NULL,
	"booking_id" uuid,
	"hall_booking_id" uuid,
	"folio_id" uuid,
	"amount_centavos" bigint NOT NULL,
	"notes" text,
	"opened_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receivables" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "receivable_entries" ADD CONSTRAINT "receivable_entries_receivable_id_receivables_id_fk" FOREIGN KEY ("receivable_id") REFERENCES "public"."receivables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_entries" ADD CONSTRAINT "receivable_entries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_entries" ADD CONSTRAINT "receivable_entries_hall_booking_id_hall_bookings_id_fk" FOREIGN KEY ("hall_booking_id") REFERENCES "public"."hall_bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_entries" ADD CONSTRAINT "receivable_entries_folio_id_folios_id_fk" FOREIGN KEY ("folio_id") REFERENCES "public"."folios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_entries" ADD CONSTRAINT "receivable_entries_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receivable_entries_receivable_idx" ON "receivable_entries" USING btree ("receivable_id");--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill: attach every existing receivable to its booking, and give it one entry (its single room).
UPDATE "receivables" r SET "order_id" = COALESCE(
	(SELECT b."order_id" FROM "bookings" b WHERE b."id" = r."booking_id"),
	(SELECT h."order_id" FROM "hall_bookings" h WHERE h."id" = r."hall_booking_id")
) WHERE r."order_id" IS NULL;--> statement-breakpoint
INSERT INTO "receivable_entries" ("receivable_id","booking_id","hall_booking_id","folio_id","amount_centavos","opened_by_user_id","created_at")
SELECT r."id", r."booking_id", r."hall_booking_id", r."folio_id", r."original_amount_centavos", r."opened_by_user_id", r."opened_at"
FROM "receivables" r
WHERE NOT EXISTS (SELECT 1 FROM "receivable_entries" e WHERE e."receivable_id" = r."id");
