CREATE TABLE "error_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"route_id" text,
	"user_id" uuid,
	"hotel_id" uuid,
	"message" text NOT NULL,
	"stack" text,
	CONSTRAINT "error_log_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
ALTER TABLE "error_log" ADD CONSTRAINT "error_log_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "error_log_occurred_idx" ON "error_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "error_log_hotel_idx" ON "error_log" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "error_log_route_message_idx" ON "error_log" USING btree ("route_id","message");