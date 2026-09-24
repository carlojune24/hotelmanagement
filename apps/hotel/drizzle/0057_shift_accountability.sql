ALTER TABLE "cashier_shifts" ADD COLUMN "closed_on_behalf" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD COLUMN "close_reason" text;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD COLUMN "stale_shift_hours" integer DEFAULT 16 NOT NULL;