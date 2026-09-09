CREATE TYPE "public"."document_series_status" AS ENUM('active', 'exhausted', 'superseded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('issued', 'cancelled', 'spoiled');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('invoice', 'official_receipt');--> statement-breakpoint
CREATE TABLE "bir_settings" (
	"hotel_id" uuid PRIMARY KEY NOT NULL,
	"tin" text,
	"is_vat_registered" boolean DEFAULT true NOT NULL,
	"registered_address" text,
	"bir_permit_no" text,
	"permit_date_issued" date,
	"accredited_printer_name" text,
	"accredited_printer_tin" text,
	"accredited_printer_accreditation_no" text,
	"printer_accreditation_date" date,
	"invoice_prefix" text DEFAULT 'INV' NOT NULL,
	"or_prefix" text DEFAULT 'OR' NOT NULL,
	"serial_pad_width" integer DEFAULT 6 NOT NULL,
	"auto_issue_invoice_on_checkout" boolean DEFAULT true NOT NULL,
	"auto_issue_receipt_on_payment" boolean DEFAULT true NOT NULL,
	"footer_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"prefix" text NOT NULL,
	"serial_from" bigint NOT NULL,
	"serial_to" bigint NOT NULL,
	"next_serial" bigint NOT NULL,
	"atp_or_permit_no" text,
	"date_registered" date,
	"accredited_printer" text,
	"accreditation_no" text,
	"status" "document_series_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"series_id" uuid NOT NULL,
	"serial_no" bigint NOT NULL,
	"formatted_no" text NOT NULL,
	"status" "document_status" DEFAULT 'issued' NOT NULL,
	"folio_id" uuid,
	"order_id" uuid,
	"booking_id" uuid,
	"hall_booking_id" uuid,
	"payment_id" uuid,
	"applies_to_document_id" uuid,
	"replaces_document_id" uuid,
	"replaced_by_document_id" uuid,
	"bill_to_name" text,
	"bill_to_address" text,
	"bill_to_tin" text,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issued_by_user_id" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"spoiled_by_user_id" uuid,
	"spoiled_at" timestamp with time zone,
	"spoil_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bir_settings" ADD CONSTRAINT "bir_settings_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_series_id_document_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."document_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_spoiled_by_user_id_users_id_fk" FOREIGN KEY ("spoiled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_series_hotel_idx" ON "document_series" USING btree ("hotel_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "document_series_one_active_idx" ON "document_series" USING btree ("hotel_id","type") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "documents_hotel_idx" ON "documents" USING btree ("hotel_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_series_serial_idx" ON "documents" USING btree ("series_id","serial_no");--> statement-breakpoint
CREATE INDEX "documents_folio_idx" ON "documents" USING btree ("folio_id");--> statement-breakpoint
CREATE INDEX "documents_payment_idx" ON "documents" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_one_invoice_per_folio_idx" ON "documents" USING btree ("folio_id") WHERE type = 'invoice' and status = 'issued';--> statement-breakpoint
CREATE UNIQUE INDEX "documents_one_or_per_payment_idx" ON "documents" USING btree ("payment_id") WHERE type = 'official_receipt' and status = 'issued';