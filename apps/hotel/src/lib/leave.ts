import { datesBetween } from '$lib/roster';

/** The kinds of calendar day, as shown in settings and on the DTR. */
export const CALENDAR_KINDS = ['regular_holiday', 'special_holiday', 'local_holiday', 'memo'] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];
export const CALENDAR_KIND_LABEL: Record<CalendarKind, string> = {
	regular_holiday: 'Regular holiday',
	special_holiday: 'Special non-working day',
	local_holiday: 'Local / company holiday',
	memo: 'Memorandum'
};

export const EMPLOYMENT_TYPES = [
	'regular',
	'probationary',
	'project',
	'seasonal',
	'fixed_term',
	'casual',
	'part_time'
] as const;
export const EMPLOYMENT_TYPE_LABEL: Record<(typeof EMPLOYMENT_TYPES)[number], string> = {
	regular: 'Regular',
	probationary: 'Probationary',
	project: 'Project',
	seasonal: 'Seasonal',
	fixed_term: 'Fixed-term',
	casual: 'Casual',
	part_time: 'Part-time'
};

export type LeavePolicy = {
	code: string;
	name: string;
	description: string;
	statutory: boolean;
	paid: boolean;
	daysPerYear: number;
	dayCount: 'working' | 'calendar';
	minServiceMonths: number;
	employmentTypes: string[];
	sexRestriction: 'male' | 'female' | null;
	halfDayAllowed: boolean;
	carryOverDays: number;
	cashConvertible: boolean;
	requiresDocument: boolean;
	active: boolean;
};

/**
 * Starting policies for a Philippine hotel. The statutory rows follow the law as commonly
 * summarised (verify with DOLE / counsel); everything is editable in Settings, and company
 * leaves start switched off. `daysPerYear: 0` means "no fixed yearly allowance" (not capped).
 */
export const LEAVE_DEFAULTS: LeavePolicy[] = [
	{
		code: 'SIL',
		name: 'Service Incentive Leave',
		description:
			'Labor Code Art. 95. Five paid days a year after one year of service. Not required for establishments regularly employing fewer than 10, managerial staff or field personnel, or where the employer already gives at least five days of vacation leave. Unused days may be converted to cash.',
		statutory: true,
		paid: true,
		daysPerYear: 5,
		dayCount: 'working',
		minServiceMonths: 12,
		employmentTypes: [],
		sexRestriction: null,
		halfDayAllowed: true,
		carryOverDays: 0,
		cashConvertible: true,
		requiresDocument: false,
		active: true
	},
	{
		code: 'ML',
		name: 'Maternity Leave',
		description:
			'RA 11210 (Expanded Maternity Leave). 105 days paid, plus 15 days for a solo parent; 60 days for miscarriage or emergency termination. Counted in calendar days; benefit is advanced by the employer and reimbursed by SSS.',
		statutory: true,
		paid: true,
		daysPerYear: 105,
		dayCount: 'calendar',
		minServiceMonths: 0,
		employmentTypes: [],
		sexRestriction: 'female',
		halfDayAllowed: false,
		carryOverDays: 0,
		cashConvertible: false,
		requiresDocument: true,
		active: true
	},
	{
		code: 'PL',
		name: 'Paternity Leave',
		description:
			'RA 8187. Seven days paid for a married male employee, for the first four deliveries of his lawful spouse.',
		statutory: true,
		paid: true,
		daysPerYear: 7,
		dayCount: 'calendar',
		minServiceMonths: 0,
		employmentTypes: [],
		sexRestriction: 'male',
		halfDayAllowed: false,
		carryOverDays: 0,
		cashConvertible: false,
		requiresDocument: true,
		active: true
	},
	{
		code: 'SPL',
		name: 'Solo Parent Leave',
		description:
			'RA 8972 as amended by RA 11861. Seven paid days a year for a solo parent with at least one year of service.',
		statutory: true,
		paid: true,
		daysPerYear: 7,
		dayCount: 'working',
		minServiceMonths: 12,
		employmentTypes: [],
		sexRestriction: null,
		halfDayAllowed: true,
		carryOverDays: 0,
		cashConvertible: false,
		requiresDocument: true,
		active: true
	},
	{
		code: 'VAWC',
		name: 'Violence Against Women & Children Leave',
		description:
			'RA 9262. Up to 10 paid days for a woman employee who is a victim of violence, extendable by court order.',
		statutory: true,
		paid: true,
		daysPerYear: 10,
		dayCount: 'working',
		minServiceMonths: 0,
		employmentTypes: [],
		sexRestriction: 'female',
		halfDayAllowed: false,
		carryOverDays: 0,
		cashConvertible: false,
		requiresDocument: true,
		active: true
	},
	{
		code: 'SLW',
		name: 'Special Leave for Women',
		description:
			'RA 9710 (Magna Carta of Women). Up to two months for a gynecological surgery, with at least six months of service in the last 12.',
		statutory: true,
		paid: true,
		daysPerYear: 60,
		dayCount: 'calendar',
		minServiceMonths: 6,
		employmentTypes: [],
		sexRestriction: 'female',
		halfDayAllowed: false,
		carryOverDays: 0,
		cashConvertible: false,
		requiresDocument: true,
		active: true
	},
	{
		code: 'VL',
		name: 'Vacation Leave',
		description: 'Company policy; no legal minimum. Set the allowance and who qualifies.',
		statutory: false,
		paid: true,
		daysPerYear: 5,
		dayCount: 'working',
		minServiceMonths: 12,
		employmentTypes: ['regular'],
		sexRestriction: null,
		halfDayAllowed: true,
		carryOverDays: 0,
		cashConvertible: false,
		requiresDocument: false,
		active: false
	},
	{
		code: 'SL',
		name: 'Sick Leave',
		description: 'Company policy; no legal minimum. Often needs a medical certificate past two days.',
		statutory: false,
		paid: true,
		daysPerYear: 5,
		dayCount: 'working',
		minServiceMonths: 6,
		employmentTypes: ['regular', 'probationary'],
		sexRestriction: null,
		halfDayAllowed: true,
		carryOverDays: 0,
		cashConvertible: false,
		requiresDocument: false,
		active: false
	},
	{
		code: 'EL',
		name: 'Emergency Leave',
		description: 'Company policy for urgent family or household matters.',
		statutory: false,
		paid: true,
		daysPerYear: 3,
		dayCount: 'working',
		minServiceMonths: 0,
		employmentTypes: [],
		sexRestriction: null,
		halfDayAllowed: true,
		carryOverDays: 0,
		cashConvertible: false,
		requiresDocument: false,
		active: false
	},
	{
		code: 'BL',
		name: 'Bereavement Leave',
		description: 'Company policy for the death of an immediate family member.',
		statutory: false,
		paid: true,
		daysPerYear: 3,
		dayCount: 'working',
		minServiceMonths: 0,
		employmentTypes: [],
		sexRestriction: null,
		halfDayAllowed: false,
		carryOverDays: 0,
		cashConvertible: false,
		requiresDocument: true,
		active: false
	},
	{
		code: 'BDL',
		name: 'Birthday Leave',
		description: 'Company perk; one day around the employee’s birthday.',
		statutory: false,
		paid: true,
		daysPerYear: 1,
		dayCount: 'working',
		minServiceMonths: 6,
		employmentTypes: [],
		sexRestriction: null,
		halfDayAllowed: true,
		carryOverDays: 0,
		cashConvertible: false,
		requiresDocument: false,
		active: false
	}
];

/** Whole months between hire and a date (never negative). */
export function serviceMonths(hiredOn: string, asOf: string): number {
	const [hy = 0, hm = 1, hd = 1] = hiredOn.split('-').map(Number);
	const [ay = 0, am = 1, ad = 1] = asOf.split('-').map(Number);
	let months = (ay - hy) * 12 + (am - hm);
	if (ad < hd) months -= 1;
	return Math.max(0, months);
}

export type EligibilityEmployee = { hiredOn: string; employmentType: string; sex: string };
export type EligibilityPolicy = Pick<
	LeavePolicy,
	'name' | 'minServiceMonths' | 'employmentTypes' | 'sexRestriction'
>;

/** Why this employee can't take this leave on that date, or null when they can. */
export function eligibilityError(
	policy: EligibilityPolicy,
	emp: EligibilityEmployee,
	startDate: string
): string | null {
	if (policy.sexRestriction && emp.sex !== policy.sexRestriction) {
		return `${policy.name} is for ${policy.sexRestriction} employees only.`;
	}
	if (policy.employmentTypes.length > 0 && !policy.employmentTypes.includes(emp.employmentType)) {
		return `${policy.name} is not open to ${emp.employmentType.replace('_', '-')} employees.`;
	}
	if (policy.minServiceMonths > 0 && serviceMonths(emp.hiredOn, startDate) < policy.minServiceMonths) {
		return `${policy.name} needs ${policy.minServiceMonths} months of service.`;
	}
	return null;
}

/**
 * Days a leave uses. 'calendar' counts every date in the range; 'working' counts only the dates
 * the employee is rostered to work (`workDates`). A half day is 0.5 and needs a single date.
 */
export function countLeaveDays(opts: {
	dayCount: 'working' | 'calendar';
	start: string;
	end: string;
	workDates: Set<string>;
	halfDay: 'am' | 'pm' | null;
}): number {
	const dates = datesBetween(opts.start, opts.end);
	const n =
		opts.dayCount === 'calendar' ? dates.length : dates.filter((d) => opts.workDates.has(d)).length;
	return opts.halfDay ? (n > 0 ? 0.5 : 0) : n;
}

/** Whether two requests for one person collide (two opposite half days on one date are fine). */
export function leavesOverlap(
	a: { start: string; end: string; halfDay: string | null },
	b: { start: string; end: string; halfDay: string | null }
): boolean {
	if (a.end < b.start || b.end < a.start) return false;
	const sameSingleDay = a.start === a.end && b.start === b.end && a.start === b.start;
	if (sameSingleDay && a.halfDay && b.halfDay && a.halfDay !== b.halfDay) return false;
	return true;
}
