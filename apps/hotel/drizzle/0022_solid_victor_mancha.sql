CREATE TABLE "z_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"z_counter" integer NOT NULL,
	"business_date" date NOT NULL,
	"day_close_id" uuid,
	"invoice_begin_no" text,
	"invoice_end_no" text,
	"invoice_count" integer DEFAULT 0 NOT NULL,
	"or_begin_no" text,
	"or_end_no" text,
	"or_count" integer DEFAULT 0 NOT NULL,
	"gross_sales_centavos" bigint DEFAULT 0 NOT NULL,
	"vatable_sales_centavos" bigint DEFAULT 0 NOT NULL,
	"vat_exempt_sales_centavos" bigint DEFAULT 0 NOT NULL,
	"zero_rated_sales_centavos" bigint DEFAULT 0 NOT NULL,
	"vat_centavos" bigint DEFAULT 0 NOT NULL,
	"sc_pwd_discount_centavos" bigint DEFAULT 0 NOT NULL,
	"other_discount_centavos" bigint DEFAULT 0 NOT NULL,
	"void_count" integer DEFAULT 0 NOT NULL,
	"void_amount_centavos" bigint DEFAULT 0 NOT NULL,
	"refund_count" integer DEFAULT 0 NOT NULL,
	"refund_amount_centavos" bigint DEFAULT 0 NOT NULL,
	"net_sales_centavos" bigint DEFAULT 0 NOT NULL,
	"prev_grand_total_centavos" bigint DEFAULT 0 NOT NULL,
	"new_grand_total_centavos" bigint DEFAULT 0 NOT NULL,
	"tender_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_by_user_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "z_readings" ADD CONSTRAINT "z_readings_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "z_readings" ADD CONSTRAINT "z_readings_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "z_readings_hotel_counter_idx" ON "z_readings" USING btree ("hotel_id","z_counter");--> statement-breakpoint
CREATE INDEX "z_readings_hotel_date_idx" ON "z_readings" USING btree ("hotel_id","business_date");