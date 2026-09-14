CREATE TABLE "job_toggles" (
	"hotel_id" uuid NOT NULL,
	"job_key" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid,
	CONSTRAINT "job_toggles_hotel_id_job_key_pk" PRIMARY KEY("hotel_id","job_key")
);
--> statement-breakpoint
CREATE TABLE "standalone_sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"amenity_item_id" uuid,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_centavos" bigint NOT NULL,
	"line_total_centavos" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standalone_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"method" "payment_method" NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"shift_id" uuid,
	"total_centavos" bigint NOT NULL,
	"cash_movement_id" uuid NOT NULL,
	"sold_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_toggles" ADD CONSTRAINT "job_toggles_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_toggles" ADD CONSTRAINT "job_toggles_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standalone_sale_items" ADD CONSTRAINT "standalone_sale_items_sale_id_standalone_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."standalone_sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standalone_sale_items" ADD CONSTRAINT "standalone_sale_items_amenity_item_id_amenity_items_id_fk" FOREIGN KEY ("amenity_item_id") REFERENCES "public"."amenity_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standalone_sales" ADD CONSTRAINT "standalone_sales_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standalone_sales" ADD CONSTRAINT "standalone_sales_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standalone_sales" ADD CONSTRAINT "standalone_sales_shift_id_cashier_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."cashier_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standalone_sales" ADD CONSTRAINT "standalone_sales_sold_by_user_id_users_id_fk" FOREIGN KEY ("sold_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "standalone_sale_items_sale_idx" ON "standalone_sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "standalone_sales_hotel_date_idx" ON "standalone_sales" USING btree ("hotel_id","business_date");