import { relations } from 'drizzle-orm';
import {
	bigint,
	boolean,
	date,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	time,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';
import { users } from './auth';

/**
 * Hotel-scoped HR: employee records, scheduling, DTR, payroll/payslip. Confirmed
 * scope for Phase 4 (see docs/TODO.md) — group-scoped/centralized HR across a
 * `hotel_groups` portfolio is a separate, deferred effort.
 *
 * Employee/schedule/payroll-run field shapes mirror `@mm/hr-core` / docs/standards/hr.md.
 * Enum-shaped text columns (`sex`, `employmentType`, `status`, `payBasis`,
 * `disbursement.method`) are validated against `@mm/hr-core`'s Zod enums at the app
 * layer, not `pgEnum` — same reasoning as `chart_of_accounts.subtype` in `ledger.ts`:
 * the taxonomy is a portable standard shared with other MM apps and may grow without
 * a schema migration here.
 *
 * Hours/minutes are stored as integer minutes, never a float, for the same reason
 * money is always integer centavos — convert to hours only at display/export time.
 */

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export const employees = pgTable(
	'employees',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		/** `per_<ULID>` — cross-app identity, minted via `mintRef('person')`. */
		personRef: text('person_ref').notNull().unique(),
		/** Org-assigned, natural key within this hotel. */
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
		/** `/uploads/<hotelId>/<file>` via `lib/server/uploads.ts`, same pattern as branding's
		    logo/hero images — unset shows a generic avatar, never a broken-image icon. */
		photoUrl: text('photo_url'),
		/** The employee's own contact email — for sending payslips, not a login (that's
		    `users.email`, via the separate, optional `userId` link). */
		email: text('email'),
		position: text('position').notNull(),
		department: text('department'),
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
		/** Matches punch rows on biometric import. */
		biometricEnrollId: text('biometric_enroll_id'),
		/** Optional, explicit link to an app login — an employee record does not
		 *  require one; linking is a separate action from registering the employee,
		 *  done from the Employees screen once the person has accepted a Team invite
		 *  and so has a real account to link to. `.unique()` caps it at one employee
		 *  record per account (Postgres allows unlimited NULLs alongside it, so every
		 *  unlinked employee is unaffected). */
		userId: uuid('user_id')
			.references(() => users.id, { onDelete: 'set null' })
			.unique(),
		extensions: jsonb('extensions').notNull().default({}),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		index('employees_hotel_idx').on(t.hotelId),
		uniqueIndex('employees_hotel_employee_no_idx').on(t.hotelId, t.employeeNo)
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
		 *  from the employee's `primary_hotel_id`/home hotel). */
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		employeeId: uuid('employee_id')
			.notNull()
			.references(() => employees.id, { onDelete: 'cascade' }),
		date: date('date', { mode: 'string' }).notNull(),
		isRestDay: boolean('is_rest_day').notNull().default(false),
		startTime: time('start_time'),
		endTime: time('end_time'),
		breakMinutes: integer('break_minutes').notNull().default(0),
		/** `{ start, end }`, both `HH:MM` — unset falls back to the hotel's default window. */
		nightDiffWindow: jsonb('night_diff_window'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		index('schedules_hotel_idx').on(t.hotelId),
		uniqueIndex('schedules_employee_date_idx').on(t.employeeId, t.date)
	]
);

// ---------------------------------------------------------------------------
// DTR (Daily Time Record) — paired punches against a schedule
// ---------------------------------------------------------------------------

export const dtrEntries = pgTable(
	'dtr_entries',
	{
		id: pk(),
		/** Denormalized from `schedules.hotel_id` so payroll-cost-by-property
		 *  reporting doesn't require a join back through schedules. */
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		employeeId: uuid('employee_id')
			.notNull()
			.references(() => employees.id, { onDelete: 'cascade' }),
		/** Null when a punch couldn't be paired to a schedule row (surfaced for
		 *  manual correction) — see docs/TODO.md's `pair-punches.ts`. */
		scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
		date: date('date', { mode: 'string' }).notNull(),
		timeIn: timestamp('time_in', { withTimezone: true }),
		timeOut: timestamp('time_out', { withTimezone: true }),
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
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		index('dtr_entries_hotel_idx').on(t.hotelId),
		index('dtr_entries_employee_date_idx').on(t.employeeId, t.date)
	]
);

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

export const payrollRuns = pgTable(
	'payroll_runs',
	{
		id: pk(),
		/** Hotel-scoped for this pass — a run covers one standalone hotel's cutoff.
		 *  Group-wide runs (one org across every hotel in a group) are deferred to
		 *  the group-scoped HR follow-up per docs/TODO.md. */
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		cutoffStart: date('cutoff_start', { mode: 'string' }).notNull(),
		cutoffEnd: date('cutoff_end', { mode: 'string' }).notNull(),
		payDate: date('pay_date', { mode: 'string' }).notNull(),
		/** 'draft' | 'locked' | 'posted' — @mm/hr-core's `payrollRunStatus` enum. */
		status: text('status').notNull().default('draft'),
		postedAt: timestamp('posted_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('payroll_runs_hotel_idx').on(t.hotelId)]
);

export const payrollRunLines = pgTable(
	'payroll_run_lines',
	{
		id: pk(),
		payrollRunId: uuid('payroll_run_id')
			.notNull()
			.references(() => payrollRuns.id, { onDelete: 'cascade' }),
		employeeId: uuid('employee_id')
			.notNull()
			.references(() => employees.id, { onDelete: 'restrict' }),
		costCenter: text('cost_center'),
		daysWorked: integer('days_worked').notNull().default(0),
		hoursRegularMinutes: integer('hours_regular_minutes').notNull().default(0),
		hoursOtMinutes: integer('hours_ot_minutes').notNull().default(0),
		hoursNightDiffMinutes: integer('hours_night_diff_minutes').notNull().default(0),
		/** `{ basic, overtime, holiday_premium, night_diff, allowances, other }`,
		 *  each integer centavos — @mm/hr-core's `payrollEarnings` shape. */
		earnings: jsonb('earnings').notNull(),
		grossCentavos: bigint('gross_centavos', { mode: 'number' }).notNull(),
		/** `{ sss_ee, philhealth_ee, pagibig_ee, withholding_tax, cash_advance, loans,
		 *  tardiness_undertime, other }` — @mm/hr-core's `payrollDeductions` shape. */
		deductions: jsonb('deductions').notNull(),
		/** `{ sss_er, philhealth_er, pagibig_er, ecc }` — for remittance/GL, not netted. */
		employerContributions: jsonb('employer_contributions').notNull(),
		netPayCentavos: bigint('net_pay_centavos', { mode: 'number' }).notNull(),
		thirteenthMonthAccrualCentavos: bigint('thirteenth_month_accrual_centavos', { mode: 'number' })
			.notNull()
			.default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('payroll_run_lines_run_idx').on(t.payrollRunId),
		uniqueIndex('payroll_run_lines_run_employee_idx').on(t.payrollRunId, t.employeeId)
	]
);

export const cashAdvances = pgTable(
	'cash_advances',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		employeeId: uuid('employee_id')
			.notNull()
			.references(() => employees.id, { onDelete: 'cascade' }),
		amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),
		reason: text('reason'),
		/** 'pending' | 'approved' | 'disbursed' | 'rejected' */
		status: text('status').notNull().default('pending'),
		requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
		approvedByUserId: uuid('approved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		approvedAt: timestamp('approved_at', { withTimezone: true }),
		disbursedAt: timestamp('disbursed_at', { withTimezone: true }),
		/** How much gets auto-deducted per payroll run until settled. */
		amortizationPerRunCentavos: bigint('amortization_per_run_centavos', { mode: 'number' }),
		remainingBalanceCentavos: bigint('remaining_balance_centavos', { mode: 'number' }).notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('cash_advances_hotel_employee_idx').on(t.hotelId, t.employeeId)]
);

/** Delivery tracking for a payslip — the payslip itself is rendered live from its
 *  `payroll_run_lines` row (same pattern as this app's other print documents), not
 *  stored as a generated file. */
export const payslips = pgTable(
	'payslips',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		payrollRunLineId: uuid('payroll_run_line_id')
			.notNull()
			.unique()
			.references(() => payrollRunLines.id, { onDelete: 'cascade' }),
		employeeId: uuid('employee_id')
			.notNull()
			.references(() => employees.id, { onDelete: 'cascade' }),
		emailedAt: timestamp('emailed_at', { withTimezone: true }),
		emailedTo: text('emailed_to'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('payslips_hotel_idx').on(t.hotelId)]
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const employeesRelations = relations(employees, ({ one, many }) => ({
	hotel: one(hotels, { fields: [employees.hotelId], references: [hotels.id] }),
	user: one(users, { fields: [employees.userId], references: [users.id] }),
	schedules: many(schedules),
	dtrEntries: many(dtrEntries),
	payrollRunLines: many(payrollRunLines),
	cashAdvances: many(cashAdvances)
}));

export const schedulesRelations = relations(schedules, ({ one }) => ({
	hotel: one(hotels, { fields: [schedules.hotelId], references: [hotels.id] }),
	employee: one(employees, { fields: [schedules.employeeId], references: [employees.id] })
}));

export const dtrEntriesRelations = relations(dtrEntries, ({ one }) => ({
	hotel: one(hotels, { fields: [dtrEntries.hotelId], references: [hotels.id] }),
	employee: one(employees, { fields: [dtrEntries.employeeId], references: [employees.id] }),
	schedule: one(schedules, { fields: [dtrEntries.scheduleId], references: [schedules.id] })
}));

export const payrollRunsRelations = relations(payrollRuns, ({ one, many }) => ({
	hotel: one(hotels, { fields: [payrollRuns.hotelId], references: [hotels.id] }),
	lines: many(payrollRunLines)
}));

export const payrollRunLinesRelations = relations(payrollRunLines, ({ one }) => ({
	run: one(payrollRuns, { fields: [payrollRunLines.payrollRunId], references: [payrollRuns.id] }),
	employee: one(employees, { fields: [payrollRunLines.employeeId], references: [employees.id] })
}));

export const cashAdvancesRelations = relations(cashAdvances, ({ one }) => ({
	hotel: one(hotels, { fields: [cashAdvances.hotelId], references: [hotels.id] }),
	employee: one(employees, { fields: [cashAdvances.employeeId], references: [employees.id] })
}));

export const payslipsRelations = relations(payslips, ({ one }) => ({
	hotel: one(hotels, { fields: [payslips.hotelId], references: [hotels.id] }),
	employee: one(employees, { fields: [payslips.employeeId], references: [employees.id] }),
	runLine: one(payrollRunLines, { fields: [payslips.payrollRunLineId], references: [payrollRunLines.id] })
}));

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type Schedule = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;
export type DtrEntry = typeof dtrEntries.$inferSelect;
export type NewDtrEntry = typeof dtrEntries.$inferInsert;
export type PayrollRun = typeof payrollRuns.$inferSelect;
export type PayrollRunLine = typeof payrollRunLines.$inferSelect;
export type CashAdvance = typeof cashAdvances.$inferSelect;
export type Payslip = typeof payslips.$inferSelect;
