ALTER TABLE "schedules" ADD COLUMN "break_start" time;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "break_end" time;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD COLUMN "break_start" time;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD COLUMN "break_end" time;