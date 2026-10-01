CREATE TYPE "public"."city_application_status" AS ENUM('pending', 'approved', 'rejected', 'finalized');--> statement-breakpoint
CREATE TABLE "city_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"hotel_name" text NOT NULL,
	"address_line" text,
	"city" text,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text,
	"permit_number" text,
	"permit_expires_on" date,
	"declared_rooms" integer,
	"notes" text,
	"status" "city_application_status" DEFAULT 'pending' NOT NULL,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"entered_by" uuid,
	"hotel_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "city_applications" ADD CONSTRAINT "city_applications_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_applications" ADD CONSTRAINT "city_applications_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_applications" ADD CONSTRAINT "city_applications_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "city_applications_ref_idx" ON "city_applications" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "city_applications_status_idx" ON "city_applications" USING btree ("status","created_at");