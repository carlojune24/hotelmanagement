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
		/** PD 851 covers rank-and-file staff. Managerial employees are not entitled; Main HR marks them. */
		thirteenthMonthCovered: boolean('thirteenth_month_covered').notNull().default(true),
		thirteenthMonthNote: text('thirteenth_month_note'),
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
		/** Government coverage — a person is covered by everything unless Main HR says otherwise. */
		sssCovered: boolean('sss_covered').notNull().default(true),
		philhealthCovered: boolean('philhealth_covered').notNull().default(true),
		pagibigCovered: boolean('pagibig_covered').notNull().default(true),
		withholdingExempt: boolean('withholding_exempt').notNull().default(false),
		/** Why they're not covered / exempt, or why a base is overridden. */
		coverageNote: text('coverage_note'),
		/** `{ sss_msc?, philhealth_base?, pagibig_base? }` centavos — replaces the salary base, not the rate. */
		statutoryOverrides: jsonb('statutory_overrides').notNull().default({}),
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

/**
 * A kind of leave and its policy — one list for the whole company, decided by Main HR in Settings and
 * used by every establishment. Amending one never rewrites past approvals.
 */
export const leaveTypes = pgTable(
	'leave_types',
	{
		id: pk(),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'restrict' }),
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
	(t) => [uniqueIndex('leave_types_organization_code_idx').on(t.organizationId, t.code)]
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
		/** 'submitted' | 'approved' | 'rejected' | 'cancelled'. Main HR files and approves in one step;
		 *  anyone else's request waits as 'submitted'. Only 'approved' ever reaches the DTR. */
		status: text('status').notNull().default('approved'),
		filedByUserId: uuid('filed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		cancelNote: text('cancel_note'),
		/** Who sent it for approval and when; who decided and when, with an optional note. Null on
		 *  rows that predate approvals (they were approved on the spot). */
		submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		submittedAt: timestamp('submitted_at', { withTimezone: true }),
		decidedByUserId: uuid('decided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		decidedAt: timestamp('decided_at', { withTimezone: true }),
		decisionNote: text('decision_note'),
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
		/** 'submitted' | 'approved' | 'rejected' | 'cancelled'. Only 'approved' credits overtime. */
		status: text('status').notNull().default('approved'),
		filedByUserId: uuid('filed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		cancelNote: text('cancel_note'),
		/** Who sent it for approval and when; who decided and when, with an optional note. Null on
		 *  rows that predate approvals (they were approved on the spot). */
		submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		submittedAt: timestamp('submitted_at', { withTimezone: true }),
		decidedByUserId: uuid('decided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		decidedAt: timestamp('decided_at', { withTimezone: true }),
		decisionNote: text('decision_note'),
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
		/** 'submitted' (a manager's proposal) | 'approved' | 'rejected'. Only 'approved' days affect
		 *  rosters and DTRs; entries made by Main HR are approved on the spot. */
		status: text('status').notNull().default('approved'),
		/** Who sent it for approval and when; who decided and when, with an optional note. Null on
		 *  rows that predate approvals (they were approved on the spot). */
		submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		submittedAt: timestamp('submitted_at', { withTimezone: true }),
		decidedByUserId: uuid('decided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		decidedAt: timestamp('decided_at', { withTimezone: true }),
decisionNote: text('decision_note'),
/** Why the establishment is asking — what Main HR reads before deciding. */
proposalNote: text('proposal_note'),
createdAt: createdAt(),
updatedAt: updatedAt()
},
(t) => [uniqueIndex('calendar_days_establishment_date_idx').on(t.establishmentId, t.date)]
);

// ---------------------------------------------------------------------------
// Roster approval — one row per establishment-week
// ---------------------------------------------------------------------------

/**
 * The approval state of one establishment's Monday–Sunday roster. Absence of a row means the
 * week is a plain draft. Editing a submitted/approved week as a manager sends it back to draft,
 * so "approved" always describes exactly what was approved.
 */
export const schedulePeriods = pgTable(
	'schedule_periods',
	{
		id: pk(),
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		/** The Monday of the week. */
		weekStart: date('week_start', { mode: 'string' }).notNull(),
		/** 'draft' | 'submitted' | 'approved' | 'returned' */
		status: text('status').notNull().default('draft'),
		submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		submittedAt: timestamp('submitted_at', { withTimezone: true }),
		decidedByUserId: uuid('decided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		decidedAt: timestamp('decided_at', { withTimezone: true }),
		decisionNote: text('decision_note'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('schedule_periods_week_idx').on(t.establishmentId, t.weekStart)]
);

// ---------------------------------------------------------------------------
// DTR hand-off — one row per establishment-cutoff
// ---------------------------------------------------------------------------

/**
 * A business sending its generated DTR for a cutoff to Main HR. While `submitted` or `received`
 * the cutoff is locked for managers (raw punches and saved records); Main HR may `return` it
 * with a note, which unlocks it. No row means the cutoff is still a draft.
 */
export const dtrSubmissions = pgTable(
	'dtr_submissions',
	{
		id: pk(),
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		/** Inclusive dates. Today always a calendar month; semi-monthly cutoffs fit the same shape. */
		cutoffStart: date('cutoff_start', { mode: 'string' }).notNull(),
		cutoffEnd: date('cutoff_end', { mode: 'string' }).notNull(),
		/** 'draft' | 'submitted' | 'received' | 'returned' */
		status: text('status').notNull().default('draft'),
		submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		submittedAt: timestamp('submitted_at', { withTimezone: true }),
		decidedByUserId: uuid('decided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		decidedAt: timestamp('decided_at', { withTimezone: true }),
		decisionNote: text('decision_note'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('dtr_submissions_cutoff_idx').on(t.establishmentId, t.cutoffStart, t.cutoffEnd)
	]
);

// ---------------------------------------------------------------------------
// Payroll — a company cutoff, worked and released per establishment
// ---------------------------------------------------------------------------

/**
 * One company-wide cutoff. A person is paid once per run (so their statutory contributions are
 * computed once, on their total pay), but everything operational is per establishment — see
 * `payroll_batches`. All money is integer centavos.
 */
export const payrollRuns = pgTable(
	'payroll_runs',
	{
		id: pk(),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'restrict' }),
		cutoffStart: date('cutoff_start', { mode: 'string' }).notNull(),
		cutoffEnd: date('cutoff_end', { mode: 'string' }).notNull(),
		payDate: date('pay_date', { mode: 'string' }).notNull(),
		/** 'semi_monthly' | 'monthly' */
		frequency: text('frequency').notNull(),
		/** Working days a year (261 | 313 | 365) snapshotted from the company setting at creation. */
		dayFactor: integer('day_factor').notNull(),
		/** Someone confirmed the statutory rates in force for this period before anything was locked. */
		ratesCheckedByUserId: uuid('rates_checked_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		ratesCheckedAt: timestamp('rates_checked_at', { withTimezone: true }),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('payroll_runs_organization_idx').on(t.organizationId, t.cutoffStart)]
);

/** One establishment's payroll within a run: generated, locked and released on its own. */
export const payrollBatches = pgTable(
	'payroll_batches',
	{
		id: pk(),
		runId: uuid('run_id')
			.notNull()
			.references(() => payrollRuns.id, { onDelete: 'cascade' }),
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		/** 'draft' | 'locked' | 'released' */
		status: text('status').notNull().default('draft'),
		generatedAt: timestamp('generated_at', { withTimezone: true }),
		lockedByUserId: uuid('locked_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		lockedAt: timestamp('locked_at', { withTimezone: true }),
		releasedByUserId: uuid('released_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		releasedAt: timestamp('released_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('payroll_batches_run_establishment_idx').on(t.runId, t.establishmentId)]
);

/**
 * One person's pay for a run, grouped under their home establishment. The identity fields are
 * snapshots so a payslip never changes when an employee record is edited later.
 */
export const payrollRunLines = pgTable(
	'payroll_run_lines',
	{
		id: pk(),
		runId: uuid('run_id')
			.notNull()
			.references(() => payrollRuns.id, { onDelete: 'cascade' }),
		batchId: uuid('batch_id')
			.notNull()
			.references(() => payrollBatches.id, { onDelete: 'cascade' }),
		employeeId: uuid('employee_id')
			.notNull()
			.references(() => employees.id, { onDelete: 'restrict' }),
		/** The establishment this payslip is listed under (the person's home). */
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'restrict' }),
		personRef: text('person_ref').notNull(),
		employeeNo: text('employee_no').notNull(),
		employeeName: text('employee_name').notNull(),
		position: text('position').notNull(),
		department: text('department'),
		payBasis: text('pay_basis').notNull(),
		baseRateCentavos: bigint('base_rate_centavos', { mode: 'number' }).notNull(),
		/** Snapshots of the government numbers, shown masked on the payslip. */
		govIds: jsonb('gov_ids').notNull().default({}),
		daysWorked: integer('days_worked').notNull().default(0),
		minutesRegular: integer('minutes_regular').notNull().default(0),
		minutesOvertime: integer('minutes_overtime').notNull().default(0),
		minutesNightDiff: integer('minutes_night_diff').notNull().default(0),
		/** `{ basic, overtime, holiday_premium, night_diff, allowances, other }` — @mm/hr-core's shape. */
		earnings: jsonb('earnings').notNull(),
		grossCentavos: bigint('gross_centavos', { mode: 'number' }).notNull(),
		/** `{ sss_ee, philhealth_ee, pagibig_ee, withholding_tax, cash_advance, loans, tardiness_undertime, other }` */
		deductions: jsonb('deductions').notNull(),
		/** `{ sss_er, philhealth_er, pagibig_er, ecc }` — for remittance, not netted. */
		employerContributions: jsonb('employer_contributions').notNull(),
		netPayCentavos: bigint('net_pay_centavos', { mode: 'number' }).notNull(),
		thirteenthMonthAccrualCentavos: bigint('thirteenth_month_accrual_centavos', { mode: 'number' })
			.notNull()
			.default(0),
		/** What Main HR keyed in on top of the computed pay: allowances, other earnings, advances, loans,
		 *  other deductions, a withholding override, and a note — preserved across a regenerate. */
		adjustments: jsonb('adjustments').notNull().default({}),
		/** Daily/hourly rate used, absent days, monthly basis, taxable income — shown on the payslip. */
		detail: jsonb('detail').notNull().default({}),
		/** `{ [establishmentId]: gross centavos }` — who bears the cost of a multi-site person. */
		costByEstablishment: jsonb('cost_by_establishment').notNull().default({}),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('payroll_run_lines_run_employee_idx').on(t.runId, t.employeeId),
		index('payroll_run_lines_batch_idx').on(t.batchId)
	]
);

/**
 * One agency's remittance for one calendar month (month of the pay date). Amounts are computed live
 * from locked/released payroll lines while `open`; marking it `remitted` snapshots the total, and the
 * batches feeding it can no longer be unlocked.
 */
export const remittances = pgTable(
	'remittances',
	{
		id: pk(),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'restrict' }),
		/** 'sss' | 'philhealth' | 'pagibig' | 'bir' */
		agency: text('agency').notNull(),
		/** `YYYY-MM` */
		period: text('period').notNull(),
		/** 'open' | 'remitted' */
		status: text('status').notNull().default('open'),
		dueDate: date('due_date', { mode: 'string' }),
		remittedOn: date('remitted_on', { mode: 'string' }),
		referenceNo: text('reference_no'),
		/** Snapshot at the moment it was marked remitted. */
		amountCentavos: bigint('amount_centavos', { mode: 'number' }),
		lineCount: integer('line_count'),
		remittedByUserId: uuid('remitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		note: text('note'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('remittances_org_agency_period_idx').on(t.organizationId, t.agency, t.period)]
);

/**
 * The kinds of loan Main HR deducts from pay. `key` is what a loan stores (immutable, so renaming a type never
 * breaks history); `remit_to` decides which remittance schedule its deductions land on.
 */
export const loanTypes = pgTable(
	'loan_types',
	{
		id: pk(),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'restrict' }),
		key: text('key').notNull(),
		name: text('name').notNull(),
		/** 'sss' | 'pagibig' | 'none' — 'none' is deducted from pay but remitted to no agency here. */
		remitTo: text('remit_to').notNull().default('none'),
		active: boolean('active').notNull().default(true),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('loan_types_org_key_idx').on(t.organizationId, t.key)]
);

/**
 * A loan taken out against an employee's pay: SSS / Pag-IBIG government loans (collected and remitted
 * separately from contributions) or a company loan. The balance is never stored — it is the principal less
 * what was deducted on locked/released payslips (`payroll_loan_deductions`), so it cannot go stale.
 */
export const employeeLoans = pgTable(
	'employee_loans',
	{
		id: pk(),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'restrict' }),
		employeeId: uuid('employee_id')
			.notNull()
			.references(() => employees.id, { onDelete: 'restrict' }),
		/** 'sss_salary' | 'sss_calamity' | 'pagibig_mpl' | 'pagibig_calamity' | 'pagibig_housing' | 'company' */
		kind: text('kind').notNull(),
		referenceNo: text('reference_no'),
		principalCentavos: bigint('principal_centavos', { mode: 'number' }).notNull(),
		/** The monthly amount; a semi-monthly run takes half in each cutoff. */
		amortizationCentavos: bigint('amortization_centavos', { mode: 'number' }).notNull(),
		/** Paid before this system took over deductions; counts against the principal like a deduction. */
		alreadyPaidCentavos: bigint('already_paid_centavos', { mode: 'number' }).notNull().default(0),
		/** `YYYY-MM` — the first pay month it is deducted in. */
		startPeriod: text('start_period').notNull(),
		/** The date the agency or company actually released the loan; the first deduction month is `start_period`. */
		releasedOn: date('released_on', { mode: 'string' }),
		/** Months the agreement runs for, when known. Informational: the balance still decides when it ends. */
		termMonths: integer('term_months'),
		/** 'active' | 'paused' | 'paid_off' | 'cancelled' */
		status: text('status').notNull().default('active'),
		/** Why it was cancelled, paused or closed early. */
		statusNote: text('status_note'),
		note: text('note'),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('employee_loans_employee_idx').on(t.employeeId), index('employee_loans_org_status_idx').on(t.organizationId, t.status)]
);

/**
 * Money received against a loan outside payroll (cash, bank transfer, early settlement). It counts
 * against the balance like a deduction but never appears on a remittance schedule. Voided, never deleted.
 */
export const employeeLoanPayments = pgTable(
	'employee_loan_payments',
	{
		id: pk(),
		loanId: uuid('loan_id')
			.notNull()
			.references(() => employeeLoans.id, { onDelete: 'restrict' }),
		paidOn: date('paid_on', { mode: 'string' }).notNull(),
		amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),
		note: text('note'),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		voidedAt: timestamp('voided_at', { withTimezone: true }),
		voidedByUserId: uuid('voided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		voidReason: text('void_reason'),
		/** Set when the money was taken from the employee's final pay on a separation. */
		separationId: uuid('separation_id').references(() => separations.id, { onDelete: 'restrict' })
	},
	(t) => [index('employee_loan_payments_loan_idx').on(t.loanId)]
);

/**
 * A bonus run for one establishment: the 13th month (mid-year installment or year-end balance) or any
 * other bonus (Christmas, productivity…). Lines are snapshots; an issued batch never recomputes.
 * Paid in cash outside payroll, so it never touches a payslip or a remittance schedule.
 */
export const bonusBatches = pgTable(
	'bonus_batches',
	{
		id: pk(),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'restrict' }),
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'restrict' }),
		/** 'thirteenth_mid_year' | 'thirteenth_year_end' | 'other' */
		kind: text('kind').notNull(),
		label: text('label').notNull(),
		year: integer('year').notNull(),
		/** Mid-year only: basic earned up to this date is accrued. */
		throughDate: date('through_date', { mode: 'string' }),
		/** 'draft' | 'issued' */
		status: text('status').notNull().default('draft'),
		issuedOn: date('issued_on', { mode: 'string' }),
		issuedByUserId: uuid('issued_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('bonus_batches_unique_idx').on(t.establishmentId, t.kind, t.year, t.label)]
);

export const bonusLines = pgTable(
	'bonus_lines',
	{
		id: pk(),
		batchId: uuid('batch_id')
			.notNull()
			.references(() => bonusBatches.id, { onDelete: 'restrict' }),
		employeeId: uuid('employee_id')
			.notNull()
			.references(() => employees.id, { onDelete: 'restrict' }),
		employeeNo: text('employee_no').notNull(),
		employeeName: text('employee_name').notNull(),
		position: text('position'),
		/** The 13th-month working, frozen: basic earned and late/undertime in the period. */
		basicEarnedCentavos: bigint('basic_earned_centavos', { mode: 'number' }).notNull().default(0),
		lateCentavos: bigint('late_centavos', { mode: 'number' }).notNull().default(0),
		/** `(basic − late) ÷ 12` for the period. */
		accruedCentavos: bigint('accrued_centavos', { mode: 'number' }).notNull().default(0),
		/** Already paid for the year (mid-year installment, or the 13th month in final pay). */
		alreadyPaidCentavos: bigint('already_paid_centavos', { mode: 'number' }).notNull().default(0),
		/** What this batch pays. */
		amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull().default(0),
		/** 'not_covered' | 'under_one_month' | 'nothing_earned' | 'paid_in_final_pay' */
		excludedReason: text('excluded_reason'),
		note: text('note'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('bonus_lines_batch_employee_idx').on(t.batchId, t.employeeId)]
);

/**
 * One person leaving the company: the last day, the final-pay statement, what they still owe and the
 * clearance. Everything is entered on one page. A person stays `in_process` (and is monitored as
 * owing) until nothing is owed and the checklist is done.
 */
export const separations = pgTable(
	'separations',
	{
		id: pk(),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'restrict' }),
		employeeId: uuid('employee_id')
			.notNull()
			.references(() => employees.id, { onDelete: 'restrict' }),
		/** 'resigned' | 'terminated' | 'end_of_contract' | 'retired' */
		kind: text('kind').notNull(),
		lastDay: date('last_day', { mode: 'string' }).notNull(),
		note: text('note'),
		/** 'in_process' | 'cleared' */
		status: text('status').notNull().default('in_process'),
		/** When the money owed to the employee was handed over. */
		finalPayPaidOn: date('final_pay_paid_on', { mode: 'string' }),
		finalPayPaidByUserId: uuid('final_pay_paid_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		clearedAt: timestamp('cleared_at', { withTimezone: true }),
		clearedByUserId: uuid('cleared_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		startedByUserId: uuid('started_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('separations_employee_idx').on(t.employeeId),
		index('separations_org_status_idx').on(t.organizationId, t.status)
	]
);

/**
 * A line on the final-pay statement. `credit` is owed to the employee (13th month, leave conversion,
 * anything else); `charge` is an accountability charged against it (uniform, equipment, advance);
 * `receipt` is cash received from the employee toward charges; `writeoff` forgives part of what is
 * left. Voided, never deleted.
 */
export const separationItems = pgTable(
	'separation_items',
	{
		id: pk(),
		separationId: uuid('separation_id')
			.notNull()
			.references(() => separations.id, { onDelete: 'restrict' }),
		/** 'credit' | 'charge' | 'receipt' | 'writeoff' */
		kind: text('kind').notNull(),
		label: text('label').notNull(),
		amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),
		note: text('note'),
		/** Set when the line was computed, not typed: 'thirteenth_month' (with `source_year`). */
		source: text('source'),
		sourceYear: integer('source_year'),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		voidedAt: timestamp('voided_at', { withTimezone: true }),
		voidReason: text('void_reason')
	},
	(t) => [index('separation_items_separation_idx').on(t.separationId)]
);

/** The clearance checklist for one separation (seeded from a default list; items can be added). */
export const separationClearance = pgTable(
	'separation_clearance',
	{
		id: pk(),
		separationId: uuid('separation_id')
			.notNull()
			.references(() => separations.id, { onDelete: 'restrict' }),
		label: text('label').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		doneAt: timestamp('done_at', { withTimezone: true }),
		doneByUserId: uuid('done_by_user_id').references(() => users.id, { onDelete: 'set null' })
	},
	(t) => [index('separation_clearance_separation_idx').on(t.separationId)]
);

/** A scanned agreement or the agency's approval voucher. The file is served only to payroll users. */
export const employeeLoanDocuments = pgTable(
	'employee_loan_documents',
	{
		id: pk(),
		loanId: uuid('loan_id')
			.notNull()
			.references(() => employeeLoans.id, { onDelete: 'restrict' }),
		/** `<ulid>.<ext>` under the loan-documents directory. */
		storedName: text('stored_name').notNull(),
		originalName: text('original_name').notNull(),
		contentType: text('content_type').notNull(),
		sizeBytes: integer('size_bytes').notNull(),
		uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('employee_loan_documents_loan_idx').on(t.loanId)]
);

/**
 * A pay month (`YYYY-MM`, by pay date) in which a loan is not deducted. The loan simply takes one month
 * longer per skip; nothing is carried as a shortfall.
 */
export const employeeLoanSkips = pgTable(
	'employee_loan_skips',
	{
		id: pk(),
		loanId: uuid('loan_id')
			.notNull()
			.references(() => employeeLoans.id, { onDelete: 'restrict' }),
		payMonth: text('pay_month').notNull(),
		reason: text('reason').notNull(),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('employee_loan_skips_loan_month_idx').on(t.loanId, t.payMonth)]
);

/**
 * What one payslip line took (or failed to take) for one loan. Written when a batch is generated and
 * replaced with the line on a regenerate; it only counts once its batch is locked. `reference_no` and
 * `kind` are snapshots so a filed schedule never changes if the loan is edited.
 */
export const payrollLoanDeductions = pgTable(
	'payroll_loan_deductions',
	{
		id: pk(),
		loanId: uuid('loan_id')
			.notNull()
			.references(() => employeeLoans.id, { onDelete: 'restrict' }),
		lineId: uuid('line_id')
			.notNull()
			.references(() => payrollRunLines.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull(),
		/** The remittance schedule at the time ('sss_loan' | 'pagibig_loan'), null if not remitted. */
		agency: text('agency'),
		referenceNo: text('reference_no'),
		/** The scheduled share plus anything carried over from earlier shortfalls, capped at the balance. */
		dueCentavos: bigint('due_centavos', { mode: 'number' }).notNull(),
		/** What the pay could cover; `due - deducted` is carried to the next cutoff. */
		deductedCentavos: bigint('deducted_centavos', { mode: 'number' }).notNull(),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('payroll_loan_deductions_loan_line_idx').on(t.loanId, t.lineId)]
);

/**
 * A notice from Main HR shown on the dashboard of the establishments it is addressed to. `audience` is
 * a list of establishment ids, or null for every establishment. It stops showing after `expires_on`
 * (inclusive) or once archived; nothing is ever deleted.
 */
export const announcements = pgTable(
	'announcements',
	{
		id: pk(),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'restrict' }),
		title: text('title').notNull(),
		body: text('body').notNull(),
		audience: jsonb('audience'),
		pinned: boolean('pinned').notNull().default(false),
		expiresOn: date('expires_on', { mode: 'string' }),
		/** 'active' | 'archived' */
		status: text('status').notNull().default('active'),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('announcements_org_status_idx').on(t.organizationId, t.status)]
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
export type SchedulePeriod = typeof schedulePeriods.$inferSelect;
export type DtrSubmission = typeof dtrSubmissions.$inferSelect;
export type EmployeeLoan = typeof employeeLoans.$inferSelect;
export type LoanType = typeof loanTypes.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
export type PayrollRun = typeof payrollRuns.$inferSelect;
export type PayrollBatch = typeof payrollBatches.$inferSelect;
export type PayrollRunLineRow = typeof payrollRunLines.$inferSelect;
export type Remittance = typeof remittances.$inferSelect;
