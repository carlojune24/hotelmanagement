import { relations, sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	date,
	index,
	integer,
	jsonb,
	doublePrecision,
	pgTable,
	text,
	time,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, updatedAt } from './_shared';
import { establishments, organizations } from './org';
import { users } from './auth';

/**
 * Establishment-scoped HR: employee records, scheduling, DTR, leave, overtime. Moved out of the
 * establishment app (docs/HR_PLAN.md, phase 2) with parity behaviour: one employee row per establishment,
 * HR files and approves in one step. Phase 3 makes employees company-wide with assignments;
 * phase 4 adds the approval states. Payroll tables arrive with payroll (phase 8).
 *
 * Employee/schedule field shapes mirror `@mm/hr-core`. Enum-shaped text columns are validated
 * against its Zod enums at the app layer, not `pgEnum`. Hours/minutes are stored as integer
 * minutes, never a float, for the same reason money is always integer centavos.
 */

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export const employees = pgTable(
	'employees',
	{
		id: pk(),
		/** The company the person works for. Where they work is `employee_assignments`. */
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'restrict' }),
		/** `per_<ULID>` — cross-app identity, minted via `mintRef('person')`. */
		personRef: text('person_ref').notNull().unique(),
		/** Org-assigned, natural key within the company. */
		employeeNo: text('employee_no').notNull(),
		firstName: text('first_name').notNull(),
		lastName: text('last_name').notNull(),
		middleName: text('middle_name'),
		suffix: text('suffix'),
		birthdate: date('birthdate', { mode: 'string' }).notNull(),
		/** `male` | `female` — @mm/hr-core's `sex` enum. */
		sex: text('sex').notNull(),
		hiredOn: date('hired_on', { mode: 'string' }).notNull(),
		/** @mm/hr-core's `employmentType` enum. */
		employmentType: text('employment_type').notNull(),
		/** @mm/hr-core's `employeeStatus` enum. */
		status: text('status').notNull().default('active'),
		separatedOn: date('separated_on', { mode: 'string' }),
		/** `/uploads/<establishmentId>/<file>` via `lib/server/uploads.ts` — unset shows a generic avatar. */
		photoUrl: text('photo_url'),
		/** The employee's own contact email — for sending payslips. */
		email: text('email'),
		/** Ties payroll cost to a GL dimension. */
		costCenter: text('cost_center'),
		/** @mm/hr-core's `payBasis` enum. */
		payBasis: text('pay_basis').notNull(),
		/** Per the `payBasis` unit — integer centavos. */
		baseRateCentavos: bigint('base_rate_centavos', { mode: 'number' }).notNull(),
		/** `{ sss?, philhealth?, pagibig?, tin? }` — @mm/hr-core's `govIds` shape. */
		govIds: jsonb('gov_ids').notNull().default({}),
		/** `{ method, bank_code?, account_name?, account_no? }` — @mm/hr-core's `disbursement` shape. */
		disbursement: jsonb('disbursement').notNull().default({ method: 'cash' }),
		extensions: jsonb('extensions').notNull().default({}),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		index('employees_organization_idx').on(t.organizationId),
		uniqueIndex('employees_organization_employee_no_idx').on(t.organizationId, t.employeeNo)
	]
);

// ---------------------------------------------------------------------------
// Assignments — where an employee works
// ---------------------------------------------------------------------------

/**
 * An employee's place of work, with dates. Visibility, roster membership and biometric matching
 * at an establishment all follow an open assignment (`end_date` null or not yet passed). Position,
 * department and the biometric device ID are per-assignment because a person can hold a different
 * post, and a different device ID, at each site.
 */
export const employeeAssignments = pgTable(
	'employee_assignments',
	{
		id: pk(),
		employeeId: uuid('employee_id')
			.notNull()
			.references(() => employees.id, { onDelete: 'cascade' }),
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		startDate: date('start_date', { mode: 'string' }).notNull(),
		/** Inclusive last day; null = ongoing. */
		endDate: date('end_date', { mode: 'string' }),
		/** The person's home establishment — exactly one open assignment is primary. */
		isPrimary: boolean('is_primary').notNull().default(false),
		position: text('position').notNull(),
		department: text('department'),
		/** Matches punch rows on biometric import for this establishment. */
		biometricEnrollId: text('biometric_enroll_id'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('employee_assignments_establishment_idx').on(t.establishmentId),
		index('employee_assignments_employee_idx').on(t.employeeId),
		// At most one open assignment per person per establishment.
		uniqueIndex('employee_assignments_open_idx')
			.on(t.employeeId, t.establishmentId)
			.where(sql`end_date is null`),
		// At most one open primary assignment per person.
		uniqueIndex('employee_assignments_primary_idx')
			.on(t.employeeId)
			.where(sql`is_primary and end_date is null`)
	]
);

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export const schedules = pgTable(
	'schedules',
	{
		id: pk(),
		/** Required — the specific property this shift is worked at (may differ
		 *  from the home establishment). */
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		employeeId: uuid('employee_id')
			.notNull()
			.references(() => employees.id, { onDelete: 'cascade' }),
		date: date('date', { mode: 'string' }).notNull(),
		isRestDay: boolean('is_rest_day').notNull().default(false),
		startTime: time('start_time'),
		endTime: time('end_time'),
		breakMinutes: integer('break_minutes').notNull().default(0),
		/** Split shift: the unpaid break window (e.g. 12:00–13:00). Both null for a straight
		 *  shift; when set, `breakMinutes` is always the gap between them. */
		breakStart: time('break_start'),
		breakEnd: time('break_end'),
		/** `{ start, end }`, both `HH:MM` — unset falls back to the establishment's default window. */
		nightDiffWindow: jsonb('night_diff_window'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		index('schedules_establishment_idx').on(t.establishmentId),
		uniqueIndex('schedules_employee_date_idx').on(t.employeeId, t.date)
	]
);

// ---------------------------------------------------------------------------
// Shift templates — app-level roster shortcuts
// ---------------------------------------------------------------------------

/**
 * A reusable shift ("Morning 07:00–15:00", "Rest day") a roster cell can be painted
 * with. Deliberately **not** part of the portable `@mm/hr-core` standard: applying a
 * template just writes ordinary `schedules` rows (copying the times in), so nothing
 * downstream ever needs to know a template existed and editing/deleting one never
 * rewrites a roster that was already built from it.
 */
export const shiftTemplates = pgTable(
	'shift_templates',
	{
		id: pk(),
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		isRestDay: boolean('is_rest_day').notNull().default(false),
		/** Null for a rest-day template. `endTime < startTime` means the shift ends the next day. */
		startTime: time('start_time'),
		endTime: time('end_time'),
		breakMinutes: integer('break_minutes').notNull().default(0),
		breakStart: time('break_start'),
		breakEnd: time('break_end'),
		/** `{ start, end }` (`HH:MM`) copied into `schedules.night_diff_window` on apply; null = establishment default. */
		nightDiffWindow: jsonb('night_diff_window'),
		/** `neutral` | `brand` | `ok` | `warning` — a fixed set of staff-theme tokens, never a free colour. */
		tag: text('tag').notNull().default('neutral'),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		index('shift_templates_establishment_idx').on(t.establishmentId),
		uniqueIndex('shift_templates_establishment_name_idx')
			.on(t.establishmentId, t.name)
			.where(sql`deleted_at is null`)
	]
);

// ---------------------------------------------------------------------------
// DTR (Daily Time Record) — paired punches against a schedule
// ---------------------------------------------------------------------------

export const dtrEntries = pgTable(
	'dtr_entries',
	{
		id: pk(),
		/** Denormalized from `schedules.establishment_id` so payroll-cost-by-property
		 *  reporting doesn't require a join back through schedules. */
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		employeeId: uuid('employee_id')
			.notNull()
			.references(() => employees.id, { onDelete: 'cascade' }),
		/** Null when a punch couldn't be paired to a schedule row (surfaced for
		 *  manual correction) — see docs/TODO.md's `pair-punches.ts`. */
		scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
		date: date('date', { mode: 'string' }).notNull(),
		timeIn: timestamp('time_in', { withTimezone: true }),
		timeOut: timestamp('time_out', { withTimezone: true }),
		/** Split shifts only: the lunch punches between `timeIn` and `timeOut`. */
		breakOut: timestamp('break_out', { withTimezone: true }),
		breakIn: timestamp('break_in', { withTimezone: true }),
		workedMinutes: integer('worked_minutes').notNull().default(0),
		otMinutes: integer('ot_minutes').notNull().default(0),
		nightDiffMinutes: integer('night_diff_minutes').notNull().default(0),
		tardinessMinutes: integer('tardiness_minutes').notNull().default(0),
		undertimeMinutes: integer('undertime_minutes').notNull().default(0),
		isAbsent: boolean('is_absent').notNull().default(false),
		/** 'biometric' | 'manual' */
		source: text('source').notNull().default('manual'),
		/** The raw ZKTeco enroll id this entry paired from, if biometric-sourced —
		 *  kept even after pairing so a later re-pair/audit can trace it back. */
		biometricEnrollId: text('biometric_enroll_id'),
		correctedByUserId: uuid('corrected_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		correctionNote: text('correction_note'),
		/** What to flag on the printed DTR (missing punch, added by hand…). */
		remarks: text('remarks'),
		/** The approved leave / calendar day this row stands for, when it came from one. */
		leaveRequestId: uuid('leave_request_id').references(() => leaveRequests.id, {
			onDelete: 'set null'
		}),
		calendarDayId: uuid('calendar_day_id').references(() => calendarDays.id, {
			onDelete: 'set null'
		}),
		/** Minutes credited as paid leave (counted inside `workedMinutes`). */
		leaveMinutes: integer('leave_minutes').notNull().default(0),
		/** Minutes past scheduled end that were punched but have no approved overtime
		 *  application; `otMinutes` carries only the approved part. */
		unapprovedOtMinutes: integer('unapproved_ot_minutes').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		index('dtr_entries_establishment_idx').on(t.establishmentId),
		index('dtr_entries_employee_date_idx').on(t.employeeId, t.date)
	]
);

/**
 * A saved column mapping for a biometric export: which column holds the biometric id and
 * which the date/time. App-level (not part of the portable `@mm/hr-core` standard) — one
 * per device brand/export format a establishment uses.
 */
export const biometricImportTemplates = pgTable(
	'biometric_import_templates',
	{
		id: pk(),
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** Zero-based column positions. */
		idColumn: integer('id_column').notNull(),
		datetimeColumn: integer('datetime_column').notNull(),
		hasHeader: boolean('has_header').notNull().default(true),
		/** `auto` | `ymd` | `mdy` | `dmy` — see `lib/hr-import.ts`. */
		dateFormat: text('date_format').notNull().default('auto'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		index('biometric_import_templates_establishment_idx').on(t.establishmentId),
		uniqueIndex('biometric_import_templates_establishment_name_idx')
			.on(t.establishmentId, t.name)
			.where(sql`deleted_at is null`)
	]
);

/** One uploaded biometric file. `period` is the year-month it was filed under (`YYYY-MM`). */
export const biometricUploads = pgTable(
	'biometric_uploads',
	{
		id: pk(),
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		fileName: text('file_name').notNull(),
		period: text('period').notNull(),
		punchCount: integer('punch_count').notNull().default(0),
		newCount: integer('new_count').notNull().default(0),
		uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('biometric_uploads_establishment_period_idx').on(t.establishmentId, t.period)]
);

/**
 * Every punch ever imported from a biometric device, exactly as it was read: append-only,
 * never edited. DTR is generated from these (plus schedules), so a punch whose ID matched
 * nobody at import time isn't lost; set the employee's Biometric ID and generate again.
 */
export const biometricPunches = pgTable(
	'biometric_punches',
	{
		id: pk(),
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		/** The uploaded file this punch came from; null for punches added by hand. */
		uploadId: uuid('upload_id').references(() => biometricUploads.id, { onDelete: 'cascade' }),
		/** 'file' | 'manual' (added by staff because the employee forgot to punch). */
		source: text('source').notNull().default('file'),
		/** Why a manual punch was added. */
		note: text('note'),
		addedByUserId: uuid('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		/** The ID as it appeared in the file (`0042`). */
		enrollId: text('enroll_id').notNull(),
		/** Normalised ID (`42`) — what matching and de-duplication use. */
		enrollKey: text('enroll_key').notNull(),
		punchedAt: timestamp('punched_at', { withTimezone: true }).notNull(),
		sourceFile: text('source_file'),
		importedByUserId: uuid('imported_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('biometric_punches_unique_idx').on(t.establishmentId, t.enrollKey, t.punchedAt),
		index('biometric_punches_establishment_time_idx').on(t.establishmentId, t.punchedAt)
	]
);

// ---------------------------------------------------------------------------
// Leave, holidays and memorandums
// ---------------------------------------------------------------------------

/** A kind of leave and its policy. Edited in Settings; amending one never rewrites past approvals. */
export const leaveTypes = pgTable(
	'leave_types',
	{
		id: pk(),
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		/** Short label printed on the DTR (`SIL`, `SL`). */
		code: text('code').notNull(),
		name: text('name').notNull(),
		/** What this leave is for, shown in settings (the legal basis for statutory ones). */
		description: text('description'),
		statutory: boolean('statutory').notNull().default(false),
		paid: boolean('paid').notNull().default(true),
		daysPerYear: doublePrecision('days_per_year')
			.notNull()
			.default(0),
		/** 'working' counts only rostered work days; 'calendar' counts every day in the range. */
		dayCount: text('day_count').notNull().default('working'),
		minServiceMonths: integer('min_service_months').notNull().default(0),
		/** Employment types that may take it; empty = everyone. */
		employmentTypes: text('employment_types').array().notNull().default([]),
		/** 'male' | 'female' | null */
		sexRestriction: text('sex_restriction'),
		halfDayAllowed: boolean('half_day_allowed').notNull().default(false),
		carryOverDays: doublePrecision('carry_over_days')
			.notNull()
			.default(0),
		cashConvertible: boolean('cash_convertible').notNull().default(false),
		requiresDocument: boolean('requires_document').notNull().default(false),
		active: boolean('active').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('leave_types_establishment_code_idx').on(t.establishmentId, t.code)]
);

export const leaveRequests = pgTable(
	'leave_requests',
	{
		id: pk(),
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		employeeId: uuid('employee_id')
			.notNull()
			.references(() => employees.id, { onDelete: 'cascade' }),
		leaveTypeId: uuid('leave_type_id')
			.notNull()
			.references(() => leaveTypes.id, { onDelete: 'restrict' }),
		startDate: date('start_date', { mode: 'string' }).notNull(),
		endDate: date('end_date', { mode: 'string' }).notNull(),
		/** 'am' | 'pm' | null — single-day requests only. */
		halfDay: text('half_day'),
		/** Counted when filed (working days or calendar days per the type). */
		days: doublePrecision('days').notNull(),
		/** Copied from the type at filing so a later policy change never rewrites it. */
		paid: boolean('paid').notNull(),
		reason: text('reason'),
		documentNote: text('document_note'),
		/** 'approved' | 'cancelled' (HR files and approves in one step). */
		status: text('status').notNull().default('approved'),
		filedByUserId: uuid('filed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		cancelNote: text('cancel_note'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('leave_requests_establishment_dates_idx').on(t.establishmentId, t.startDate, t.endDate),
		index('leave_requests_employee_idx').on(t.employeeId)
	]
);

/**
 * An overtime application: HR files it for an employee and it is approved on the spot
 * (like leave). The DTR credits `ot_minutes` only for time worked inside an approved range.
 */
export const overtimeRequests = pgTable(
	'overtime_requests',
	{
		id: pk(),
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		employeeId: uuid('employee_id')
			.notNull()
			.references(() => employees.id, { onDelete: 'cascade' }),
		/** The shift's date; `endTime <= startTime` means the overtime runs into the next day. */
		date: date('date', { mode: 'string' }).notNull(),
		startTime: time('start_time').notNull(),
		endTime: time('end_time').notNull(),
		/** Length of the range, snapshotted when filed. */
		minutes: integer('minutes').notNull(),
		reason: text('reason'),
		/** 'approved' | 'cancelled' (HR files and approves in one step). */
		status: text('status').notNull().default('approved'),
		filedByUserId: uuid('filed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		cancelNote: text('cancel_note'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('overtime_requests_establishment_date_idx').on(t.establishmentId, t.date),
		index('overtime_requests_employee_date_idx').on(t.employeeId, t.date)
	]
);

/** Opening balances, carry-over fixes and cash conversions: days added to (+) or taken from (−) a year's balance. */
export const leaveAdjustments = pgTable(
	'leave_adjustments',
	{
		id: pk(),
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		employeeId: uuid('employee_id')
			.notNull()
			.references(() => employees.id, { onDelete: 'cascade' }),
		leaveTypeId: uuid('leave_type_id')
			.notNull()
			.references(() => leaveTypes.id, { onDelete: 'cascade' }),
		year: integer('year').notNull(),
		days: doublePrecision('days').notNull(),
		reason: text('reason').notNull(),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('leave_adjustments_employee_year_idx').on(t.employeeId, t.year)]
);

/** A holiday or memorandum that applies to everyone on that date. */
export const calendarDays = pgTable(
	'calendar_days',
	{
		id: pk(),
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		date: date('date', { mode: 'string' }).notNull(),
		name: text('name').notNull(),
		/** 'regular_holiday' | 'special_holiday' | 'local_holiday' | 'memo' */
		kind: text('kind').notNull(),
		/** Minutes credited as paid for the day; null = the full scheduled day. */
		creditMinutes: integer('credit_minutes'),
		/** Late/undertime are not counted that day (a memo letting staff go early, for instance). */
		waiveLateness: boolean('waive_lateness').notNull().default(false),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('calendar_days_establishment_date_idx').on(t.establishmentId, t.date)]
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const employeesRelations = relations(employees, ({ one, many }) => ({
	organization: one(organizations, {
		fields: [employees.organizationId],
		references: [organizations.id]
	}),
	assignments: many(employeeAssignments),
	schedules: many(schedules),
	dtrEntries: many(dtrEntries)
}));

export const employeeAssignmentsRelations = relations(employeeAssignments, ({ one }) => ({
	employee: one(employees, { fields: [employeeAssignments.employeeId], references: [employees.id] }),
	establishment: one(establishments, {
		fields: [employeeAssignments.establishmentId],
		references: [establishments.id]
	})
}));

export const schedulesRelations = relations(schedules, ({ one }) => ({
	establishment: one(establishments, { fields: [schedules.establishmentId], references: [establishments.id] }),
	employee: one(employees, { fields: [schedules.employeeId], references: [employees.id] })
}));

export const dtrEntriesRelations = relations(dtrEntries, ({ one }) => ({
	establishment: one(establishments, { fields: [dtrEntries.establishmentId], references: [establishments.id] }),
	employee: one(employees, { fields: [dtrEntries.employeeId], references: [employees.id] }),
	schedule: one(schedules, { fields: [dtrEntries.scheduleId], references: [schedules.id] })
}));

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type Schedule = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;
export type DtrEntry = typeof dtrEntries.$inferSelect;
export type NewDtrEntry = typeof dtrEntries.$inferInsert;
export type EmployeeAssignment = typeof employeeAssignments.$inferSelect;
