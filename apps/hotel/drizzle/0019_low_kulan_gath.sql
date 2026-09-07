ALTER TABLE "folio_charges" ADD COLUMN "is_base_charge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD COLUMN "voided_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;