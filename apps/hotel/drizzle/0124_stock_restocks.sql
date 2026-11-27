ALTER TYPE "public"."stock_movement_type" ADD VALUE 'restock_void';--> statement-breakpoint
CREATE TABLE "stock_restocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"receipt_date" date NOT NULL,
	"vendor_id" uuid,
	"vendor_name" text,
	"receipt_no" text,
	"total_centavos" bigint NOT NULL,
	"attachment_url" text,
	"note" text,
	"expense_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	CONSTRAINT "stock_restocks_total_positive" CHECK ("stock_restocks"."total_centavos" > 0)
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "restock_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_restocks" ADD CONSTRAINT "stock_restocks_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_restocks" ADD CONSTRAINT "stock_restocks_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_restocks" ADD CONSTRAINT "stock_restocks_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_restocks" ADD CONSTRAINT "stock_restocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_restocks" ADD CONSTRAINT "stock_restocks_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_restocks_hotel_idx" ON "stock_restocks" USING btree ("hotel_id","receipt_date");--> statement-breakpoint
CREATE INDEX "stock_restocks_expense_idx" ON "stock_restocks" USING btree ("expense_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_restock_id_stock_restocks_id_fk" FOREIGN KEY ("restock_id") REFERENCES "public"."stock_restocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_restock_idx" ON "stock_movements" USING btree ("restock_id");