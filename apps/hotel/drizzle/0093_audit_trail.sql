ALTER TABLE "audit_log" ADD COLUMN "actor_kind" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "ip_address" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "ref_code" text;--> statement-breakpoint
CREATE INDEX "audit_hotel_created_idx" ON "audit_log" USING btree ("hotel_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_ref_code_idx" ON "audit_log" USING btree ("ref_code");