CREATE TABLE "biometric_import_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"id_column" integer NOT NULL,
	"datetime_column" integer NOT NULL,
	"has_header" boolean DEFAULT true NOT NULL,
	"date_format" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "biometric_import_templates" ADD CONSTRAINT "biometric_import_templates_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "biometric_import_templates_hotel_idx" ON "biometric_import_templates" USING btree ("hotel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "biometric_import_templates_hotel_name_idx" ON "biometric_import_templates" USING btree ("hotel_id","name") WHERE deleted_at is null;