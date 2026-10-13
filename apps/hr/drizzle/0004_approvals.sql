CREATE TABLE "schedule_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"establishment_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_by_user_id" uuid,
	"submitted_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_days" ADD COLUMN "status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_days" ADD COLUMN "submitted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_days" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_days" ADD COLUMN "decided_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_days" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_days" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "submitted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "decided_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD COLUMN "submitted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD COLUMN "decided_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "schedule_periods" ADD CONSTRAINT "schedule_periods_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_periods" ADD CONSTRAINT "schedule_periods_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_periods" ADD CONSTRAINT "schedule_periods_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_periods_week_idx" ON "schedule_periods" USING btree ("establishment_id","week_start");--> statement-breakpoint
ALTER TABLE "calendar_days" ADD CONSTRAINT "calendar_days_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_days" ADD CONSTRAINT "calendar_days_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;