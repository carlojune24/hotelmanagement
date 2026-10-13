CREATE TABLE "dtr_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"establishment_id" uuid NOT NULL,
	"cutoff_start" date NOT NULL,
	"cutoff_end" date NOT NULL,
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
ALTER TABLE "dtr_submissions" ADD CONSTRAINT "dtr_submissions_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dtr_submissions" ADD CONSTRAINT "dtr_submissions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dtr_submissions" ADD CONSTRAINT "dtr_submissions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dtr_submissions_cutoff_idx" ON "dtr_submissions" USING btree ("establishment_id","cutoff_start","cutoff_end");