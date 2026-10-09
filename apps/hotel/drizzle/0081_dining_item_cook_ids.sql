ALTER TABLE "dining_order_items" ADD COLUMN IF NOT EXISTS "started_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "dining_order_items" ADD COLUMN IF NOT EXISTS "ready_by_user_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dining_order_items" ADD CONSTRAINT "dining_order_items_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dining_order_items" ADD CONSTRAINT "dining_order_items_ready_by_user_id_users_id_fk" FOREIGN KEY ("ready_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
