CREATE TABLE "support_agent_presence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"available" boolean DEFAULT false NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"max_concurrent" integer DEFAULT 3 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"visitor_token_hash" text NOT NULL,
	"guest_name" text,
	"guest_email" text,
	"order_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"assigned_user_id" uuid,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_faqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"author_user_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_agent_presence" ADD CONSTRAINT "support_agent_presence_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_agent_presence" ADD CONSTRAINT "support_agent_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_faqs" ADD CONSTRAINT "support_faqs_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."support_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_agent_presence_hotel_user_uq" ON "support_agent_presence" USING btree ("hotel_id","user_id");--> statement-breakpoint
CREATE INDEX "support_agent_presence_hotel_idx" ON "support_agent_presence" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "support_conversations_hotel_idx" ON "support_conversations" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "support_conversations_hotel_status_idx" ON "support_conversations" USING btree ("hotel_id","status");--> statement-breakpoint
CREATE INDEX "support_conversations_visitor_idx" ON "support_conversations" USING btree ("hotel_id","visitor_token_hash");--> statement-breakpoint
CREATE INDEX "support_conversations_assigned_idx" ON "support_conversations" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX "support_faqs_hotel_idx" ON "support_faqs" USING btree ("hotel_id","sort_order");--> statement-breakpoint
CREATE INDEX "support_messages_hotel_idx" ON "support_messages" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "support_messages_conversation_idx" ON "support_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
-- Capability backfill: new hotels get `support:*` from ROLE_CAPS (authz.ts); existing hotels'
-- front-desk roles need the rows inserted. hotel_admin already holds '*'.
INSERT INTO "role_permissions" ("role_id", "capability")
SELECT r."id", 'support:*'
FROM "roles" r
WHERE r."slug" = 'front_desk' AND r."deleted_at" IS NULL
ON CONFLICT DO NOTHING;
