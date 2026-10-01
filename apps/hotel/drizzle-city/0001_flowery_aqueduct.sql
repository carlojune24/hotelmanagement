CREATE TABLE "city_permits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"permit_number" text NOT NULL,
	"issued_on" date,
	"expires_on" date NOT NULL,
	"notes" text,
	"application_id" uuid,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "city_permits" ADD CONSTRAINT "city_permits_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_permits" ADD CONSTRAINT "city_permits_application_id_city_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."city_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_permits" ADD CONSTRAINT "city_permits_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "city_permits_hotel_expiry_idx" ON "city_permits" USING btree ("hotel_id","expires_on");