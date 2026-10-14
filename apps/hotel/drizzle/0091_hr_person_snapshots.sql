CREATE TABLE "hr_person_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"person_ref" text NOT NULL,
	"full_name" text NOT NULL,
	"employee_no" text NOT NULL,
	"position" text,
	"department" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_person_snapshots" ADD CONSTRAINT "hr_person_snapshots_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_person_snapshots_hotel_person_idx" ON "hr_person_snapshots" USING btree ("hotel_id","person_ref");