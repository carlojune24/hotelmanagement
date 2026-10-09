CREATE TABLE "biometric_punches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"enroll_id" text NOT NULL,
	"enroll_key" text NOT NULL,
	"punched_at" timestamp with time zone NOT NULL,
	"source_file" text,
	"imported_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "biometric_punches" ADD CONSTRAINT "biometric_punches_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_punches" ADD CONSTRAINT "biometric_punches_imported_by_user_id_users_id_fk" FOREIGN KEY ("imported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "biometric_punches_unique_idx" ON "biometric_punches" USING btree ("hotel_id","enroll_key","punched_at");--> statement-breakpoint
CREATE INDEX "biometric_punches_hotel_time_idx" ON "biometric_punches" USING btree ("hotel_id","punched_at");