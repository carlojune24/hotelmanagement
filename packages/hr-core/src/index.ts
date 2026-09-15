/**
 * @mm/hr-core — canonical org + employee master + schedule + payroll-run models,
 * Philippine statutory tables (SSS / PhilHealth / Pag-IBIG / BIR), and payroll
 * computation.
 *
 * Phase 4: employee/schedule/payroll-run shapes filled in per docs/standards/hr.md.
 * Statutory bracket tables and computation logic are placeholders — see
 * `./statutory/*` and `./compute.ts` — verify against the latest official circulars
 * before go-live.
 */
import { z } from 'zod';
import {
	amountMinor,
	currency,
	ianaTimezone,
	instant,
	orgRef,
	personRef,
	plainDate,
	sourceApp,
	uuid
} from '@mm/integration';

export const HR_CORE_VERSION = '0.2.0' as const;

export const employmentType = z.enum([
	'regular',
	'probationary',
	'project',
	'seasonal',
	'fixed_term',
	'casual',
	'part_time'
]);
export type EmploymentType = z.infer<typeof employmentType>;

export const payBasis = z.enum(['monthly', 'daily', 'hourly']);
export type PayBasis = z.infer<typeof payBasis>;

export const employeeStatus = z.enum(['active', 'on_leave', 'suspended', 'separated']);
export type EmployeeStatus = z.infer<typeof employeeStatus>;

export const sex = z.enum(['male', 'female']);
export type Sex = z.infer<typeof sex>;

// ---------------------------------------------------------------------------
// Org — see docs/standards/hr.md's "Org" section. Not a separate table in the
// hotel app: carried on `hotel_groups` (grouped hotel) or `hotels` (standalone)
// directly. This shape documents the fields those tables carry, for consumers
// that only understand the portable org identity, not this app's schema.
// ---------------------------------------------------------------------------

export const orgIdentity = z.object({
	id: uuid,
	org_ref: orgRef,
	legal_name: z.string(),
	trade_name: z.string().nullable().optional(),
	/** `NNN-NNN-NNN-NNNNN` */
	tin: z.string(),
	/** Portable-standard default only — the operative wall-clock for a specific
	 *  shift/DTR entry is always that shift's own hotel's timezone. */
	timezone: ianaTimezone,
	default_currency: currency,
	source_app: sourceApp.optional(),
	source_id: z.string().optional(),
	updated_at: instant,
	deleted_at: instant.nullable().optional()
});
export type OrgIdentity = z.infer<typeof orgIdentity>;

// ---------------------------------------------------------------------------
// Employee master
// ---------------------------------------------------------------------------

export const govIds = z.object({
	sss: z.string().optional(),
	philhealth: z.string().optional(),
	pagibig: z.string().optional(),
	tin: z.string().optional()
});
export type GovIds = z.infer<typeof govIds>;

export const disbursementMethod = z.enum(['cash', 'bank', 'ewallet']);
export type DisbursementMethod = z.infer<typeof disbursementMethod>;

export const disbursement = z.object({
	method: disbursementMethod,
	bank_code: z.string().optional(),
	account_name: z.string().optional(),
	account_no: z.string().optional()
});
export type Disbursement = z.infer<typeof disbursement>;

/** Fixed field set plus `extensions` (jsonb) for app-specific data — a consumer
 *  that does not understand an extension key ignores it. `primary_hotel_id` is
 *  app-local (hotel-app specific); omit/ignore outside this app. */
export const employeeMaster = z.object({
	id: uuid,
	/** The cross-app person key. */
	person_ref: personRef,
	org_ref: orgRef,
	/** Org-assigned, natural key within org. */
	employee_no: z.string(),
	first_name: z.string(),
	last_name: z.string(),
	middle_name: z.string().nullable().optional(),
	suffix: z.string().nullable().optional(),
	birthdate: plainDate,
	sex,
	hired_on: plainDate,
	employment_type: employmentType,
	status: employeeStatus,
	separated_on: plainDate.nullable().optional(),
	position: z.string(),
	department: z.string().nullable().optional(),
	/** Ties payroll cost to a GL dimension. */
	cost_center: z.string().nullable().optional(),
	/** App-local, hotel-app specific — nullable FK to this app's `hotels` table,
	 *  the employee's home-base property. Per-shift property is carried on
	 *  schedule/DTR rows, not here. */
	primary_hotel_id: z.string().uuid().nullable().optional(),
	pay_basis: payBasis,
	base_rate: amountMinor,
	gov_ids: govIds,
	disbursement,
	/** Matches punch rows on biometric import — app-local concern, stored here. */
	biometric_enroll_id: z.string().nullable().optional(),
	extensions: z.record(z.string(), z.unknown()).default({}),
	source_app: sourceApp.optional(),
	source_id: z.string().optional(),
	updated_at: instant,
	deleted_at: instant.nullable().optional()
});
export type EmployeeMaster = z.infer<typeof employeeMaster>;

// ---------------------------------------------------------------------------
// Schedule — app-owned shape, referenced by DTR. Per employee per calendar
// date: a shift or a rest day, plus the specific `hotel_id` this shift is
// worked at (required, not nullable).
// ---------------------------------------------------------------------------

export const scheduleEntry = z.object({
	id: uuid,
	person_ref: personRef,
	/** Required — the specific property this shift is worked at. */
	hotel_id: z.string().uuid(),
	date: plainDate,
	is_rest_day: z.boolean().default(false),
	/** `HH:MM`, unset for a rest day. */
	start_time: z.string().nullable().optional(),
	end_time: z.string().nullable().optional(),
	break_minutes: z.number().int().min(0).default(0),
	night_diff_window: z.object({ start: z.string(), end: z.string() }).nullable().optional(),
	updated_at: instant,
	deleted_at: instant.nullable().optional()
});
export type ScheduleEntry = z.infer<typeof scheduleEntry>;

// ---------------------------------------------------------------------------
// Payroll-run result — immutable once posted. One run covers one cutoff for
// one org (for a grouped hotel, every hotel in the group). Per-property split
// is a derived report, not a field here, so this shape stays portable.
// ---------------------------------------------------------------------------

export const payrollRunStatus = z.enum(['draft', 'locked', 'posted']);
export type PayrollRunStatus = z.infer<typeof payrollRunStatus>;

export const payrollEarnings = z.object({
	basic: amountMinor,
	overtime: amountMinor,
	holiday_premium: amountMinor,
	night_diff: amountMinor,
	allowances: amountMinor,
	other: amountMinor
});
export type PayrollEarnings = z.infer<typeof payrollEarnings>;

/** Employee-side deductions. */
export const payrollDeductions = z.object({
	sss_ee: amountMinor,
	philhealth_ee: amountMinor,
	pagibig_ee: amountMinor,
	withholding_tax: amountMinor,
	cash_advance: amountMinor,
	loans: amountMinor,
	tardiness_undertime: amountMinor,
	other: amountMinor
});
export type PayrollDeductions = z.infer<typeof payrollDeductions>;

/** For remittance/GL — not netted from pay. */
export const payrollEmployerContributions = z.object({
	sss_er: amountMinor,
	philhealth_er: amountMinor,
	pagibig_er: amountMinor,
	ecc: amountMinor
});
export type PayrollEmployerContributions = z.infer<typeof payrollEmployerContributions>;

export const payrollRunLine = z.object({
	person_ref: personRef,
	cost_center: z.string().nullable().optional(),
	days_worked: z.number(),
	hours_regular: z.number(),
	hours_ot: z.number(),
	hours_night_diff: z.number(),
	earnings: payrollEarnings,
	gross: amountMinor,
	deductions: payrollDeductions,
	employer_contributions: payrollEmployerContributions,
	net_pay: amountMinor,
	thirteenth_month_accrual: amountMinor
});
export type PayrollRunLine = z.infer<typeof payrollRunLine>;

export const payrollRun = z.object({
	id: uuid,
	org_ref: orgRef,
	cutoff_start: plainDate,
	cutoff_end: plainDate,
	pay_date: plainDate,
	status: payrollRunStatus,
	lines: z.array(payrollRunLine),
	posted_at: instant.nullable().optional()
});
export type PayrollRun = z.infer<typeof payrollRun>;

export * from './statutory/sss-2026';
export * from './statutory/philhealth-2026';
export * from './statutory/pagibig-2026';
export * from './statutory/bir-train';
export * from './compute';
export * from './thirteenth-month';
