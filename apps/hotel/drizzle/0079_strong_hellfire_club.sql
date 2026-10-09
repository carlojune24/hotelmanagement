CREATE TABLE "biometric_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"period" text NOT NULL,
	"punch_count" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "biometric_punches" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "biometric_punches" ADD COLUMN "source" text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE "biometric_punches" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "biometric_punches" ADD COLUMN "added_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "dtr_entries" ADD COLUMN "remarks" text;--> statement-breakpoint
ALTER TABLE "biometric_uploads" ADD CONSTRAINT "biometric_uploads_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_uploads" ADD CONSTRAINT "biometric_uploads_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "biometric_uploads_hotel_period_idx" ON "biometric_uploads" USING btree ("hotel_id","period");--> statement-breakpoint
ALTER TABLE "biometric_punches" ADD CONSTRAINT "biometric_punches_upload_id_biometric_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."biometric_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_punches" ADD CONSTRAINT "biometric_punches_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;