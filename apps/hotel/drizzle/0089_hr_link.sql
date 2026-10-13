CREATE TABLE "hr_connections" (
	"hotel_id" uuid PRIMARY KEY NOT NULL,
	"base_url" text NOT NULL,
	"api_key_enc" text NOT NULL,
	"api_key_hint" text NOT NULL,
	"establishment_name" text,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"connected_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "person_ref" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "person_ref" text;--> statement-breakpoint
ALTER TABLE "hr_connections" ADD CONSTRAINT "hr_connections_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_connections" ADD CONSTRAINT "hr_connections_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_hotel_person_idx" ON "memberships" USING btree ("hotel_id","person_ref") WHERE person_ref is not null;