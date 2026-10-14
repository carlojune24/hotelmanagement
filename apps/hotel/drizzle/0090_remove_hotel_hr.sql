-- HR moved to its own app (docs/HR_PLAN.md). Take a pg_dump before applying this: it is destructive.
-- Guard first: never drop the `hr` role out from under a login that still holds it.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "memberships" m JOIN "roles" r ON r."id" = m."role_id" WHERE r."slug" = 'hr') THEN
		RAISE EXCEPTION 'A member still holds the hr role. Move them to another role (or remove them) before running this migration.';
	END IF;
END $$;--> statement-breakpoint
UPDATE "invites" SET "status" = 'revoked' WHERE "role" = 'hr' AND "status" = 'pending';--> statement-breakpoint
-- Capabilities that no longer guard anything, on every role.
DELETE FROM "role_permissions" WHERE "capability" ~ '^(hr|employee|schedule|dtr|leave|payroll):';--> statement-breakpoint
DELETE FROM "roles" WHERE "slug" = 'hr';--> statement-breakpoint
DROP TABLE "biometric_import_templates" CASCADE;--> statement-breakpoint
DROP TABLE "biometric_punches" CASCADE;--> statement-breakpoint
DROP TABLE "biometric_uploads" CASCADE;--> statement-breakpoint
DROP TABLE "calendar_days" CASCADE;--> statement-breakpoint
DROP TABLE "cash_advances" CASCADE;--> statement-breakpoint
DROP TABLE "dtr_entries" CASCADE;--> statement-breakpoint
DROP TABLE "employees" CASCADE;--> statement-breakpoint
DROP TABLE "leave_adjustments" CASCADE;--> statement-breakpoint
DROP TABLE "leave_requests" CASCADE;--> statement-breakpoint
DROP TABLE "leave_types" CASCADE;--> statement-breakpoint
DROP TABLE "overtime_requests" CASCADE;--> statement-breakpoint
DROP TABLE "payroll_run_lines" CASCADE;--> statement-breakpoint
DROP TABLE "payroll_runs" CASCADE;--> statement-breakpoint
DROP TABLE "payslips" CASCADE;--> statement-breakpoint
DROP TABLE "schedules" CASCADE;--> statement-breakpoint
DROP TABLE "shift_templates" CASCADE;