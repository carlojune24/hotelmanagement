import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import {
	dtrEntries,
	employeeAssignments,
	employees,
	establishments,
	leaveRequests,
	payrollBatches,
	payrollRunLines,
	payrollRuns,
	separations
} from '$lib/server/db/schema/index';

/** Whole years between two ISO dates (floored), never negative. */
export function yearsBetween(from: string, to: string): number {
	const a = new Date(`${from}T00:00:00Z`);
	const b = new Date(`${to}T00:00:00Z`);
	let y = b.getUTCFullYear() - a.getUTCFullYear();
	if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) y -= 1;
	return Math.max(0, y);
}

const AGE_BANDS = [
	['Under 25', 0, 24],
	['25–34', 25, 34],
	['35–44', 35, 44],
	['45–54', 45, 54],
	['55 and over', 55, 200]
] as const;
const TENURE_BANDS = [
	['Under 1 year', 0, 0],
	['1–2 years', 1, 2],
	['3–4 years', 3, 4],
	['5–9 years', 5, 9],
	['10 years or more', 10, 200]
] as const;
const band = (bands: ReadonlyArray<readonly [string, number, number]>, n: number) =>
	bands.find(([, lo, hi]) => n >= lo && n <= hi)?.[0] ?? bands[bands.length - 1]![0];

const tally = (items: string[]) => {
	const m = new Map<string, number>();
	for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
	return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};

// ---------------------------------------------------------------------------
// 1. Headcount & demographics
// ---------------------------------------------------------------------------

export interface HeadcountReport {
	asOf: string;
	total: number;
	fullTime: number;
	partTime: number;
	byEstablishment: Array<{ name: string; count: number }>;
	byDepartment: Array<{ label: string; count: number }>;
	byEmploymentType: Array<{ label: string; count: number }>;
	bySex: Array<{ label: string; count: number }>;
	byAge: Array<{ label: string; count: number }>;
	byTenure: Array<{ label: string; count: number }>;
	people: Array<{ employeeNo: string; name: string; establishment: string; department: string; position: string; employmentType: string; sex: string; age: number; tenureYears: number; hiredOn: string }>;
}

/**
 * Everyone employed on `asOf` (hired on or before it, not separated before it), counted once under the
 * establishment of their primary assignment that day. Full-time = every employment type except part-time.
 */
export async function headcountReport(
	organizationId: string,
	opts: { asOf: string; establishmentId?: string | null }
): Promise<HeadcountReport> {
	const { asOf } = opts;
	const rows = await db
		.select({
			emp: employees,
			estName: establishments.name,
			estId: establishments.id,
			department: employeeAssignments.department,
			position: employeeAssignments.position,
			isPrimary: employeeAssignments.isPrimary
		})
		.from(employees)
		.innerJoin(employeeAssignments, eq(employeeAssignments.employeeId, employees.id))
		.innerJoin(establishments, eq(establishments.id, employeeAssignments.establishmentId))
		.where(
			and(
				eq(employees.organizationId, organizationId),
				isNull(employees.deletedAt),
				lte(employees.hiredOn, asOf),
				or(isNull(employees.separatedOn), gte(employees.separatedOn, asOf)),
				lte(employeeAssignments.startDate, asOf),
				or(isNull(employeeAssignments.endDate), gte(employeeAssignments.endDate, asOf))
			)
		);

	// One row per person: the primary assignment, else the first.
	const byPerson = new Map<string, (typeof rows)[number]>();
	for (const r of rows) {
		const cur = byPerson.get(r.emp.id);
		if (!cur || (r.isPrimary && !cur.isPrimary)) byPerson.set(r.emp.id, r);
	}
	const people = [...byPerson.values()]
		.filter((r) => !opts.establishmentId || r.estId === opts.establishmentId)
		.map((r) => ({
			employeeNo: r.emp.employeeNo,
			name: `${r.emp.lastName}, ${r.emp.firstName}`,
			establishment: r.estName,
			department: r.department?.trim() || 'No department',
			position: r.position,
			employmentType: r.emp.employmentType,
			sex: r.emp.sex,
			age: yearsBetween(r.emp.birthdate, asOf),
			tenureYears: yearsBetween(r.emp.hiredOn, asOf),
			hiredOn: r.emp.hiredOn
		}))
		.sort((a, b) => a.establishment.localeCompare(b.establishment) || a.name.localeCompare(b.name));

	const partTime = people.filter((p) => p.employmentType === 'part_time').length;
	return {
		asOf,
		total: people.length,
		fullTime: people.length - partTime,
		partTime,
		byEstablishment: tally(people.map((p) => p.establishment)).map((t) => ({ name: t.label, count: t.count })),
		byDepartment: tally(people.map((p) => p.department)),
		byEmploymentType: tally(people.map((p) => p.employmentType)),
		bySex: tally(people.map((p) => p.sex)),
		byAge: AGE_BANDS.map(([label]) => ({ label, count: people.filter((p) => band(AGE_BANDS, p.age) === label).length })),
		byTenure: TENURE_BANDS.map(([label]) => ({ label, count: people.filter((p) => band(TENURE_BANDS, p.tenureYears) === label).length })),
		people
	};
}

// ---------------------------------------------------------------------------
// 2. Payroll & compensation summary
// ---------------------------------------------------------------------------

const EARNING_KEYS = ['basic', 'overtime', 'holiday_premium', 'night_diff', 'allowances', 'other'] as const;
const DEDUCTION_KEYS = ['sss_ee', 'philhealth_ee', 'pagibig_ee', 'withholding_tax', 'cash_advance', 'loans', 'tardiness_undertime', 'other'] as const;
const EMPLOYER_KEYS = ['sss_er', 'philhealth_er', 'pagibig_er', 'ecc'] as const;

export type PayrollTotals = {
	people: number;
	payslips: number;
	earnings: Record<(typeof EARNING_KEYS)[number], number>;
	gross: number;
	deductions: Record<(typeof DEDUCTION_KEYS)[number], number>;
	net: number;
	employer: Record<(typeof EMPLOYER_KEYS)[number], number>;
};

const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
const emptyTotals = (): PayrollTotals => ({
	people: 0,
	payslips: 0,
	earnings: zero(EARNING_KEYS),
	gross: 0,
	deductions: zero(DEDUCTION_KEYS),
	net: 0,
	employer: zero(EMPLOYER_KEYS)
});

export interface PayrollSummary {
	from: string;
	to: string;
	total: PayrollTotals;
	byEstablishment: Array<{ name: string } & PayrollTotals>;
	byDepartment: Array<{ name: string } & PayrollTotals>;
	/** Lines still in a draft batch that were counted (only when drafts are included). */
	draftLines: number;
}

/**
 * Compensation summary over runs whose cutoff ends in `[from, to]`: earnings, gross, employee deductions,
 * net, and employer contributions, by establishment and by department. Locked and released payslips only,
 * unless `includeDrafts`. Sums the same line figures the payroll register prints, so they reconcile.
 */
export async function payrollSummary(
	organizationId: string,
	opts: { from: string; to: string; establishmentId?: string | null; includeDrafts?: boolean }
): Promise<PayrollSummary> {
	const rows = await db
		.select({ line: payrollRunLines, status: payrollBatches.status, estName: establishments.name })
		.from(payrollRunLines)
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
		.innerJoin(establishments, eq(establishments.id, payrollRunLines.establishmentId))
		.where(
			and(
				eq(payrollRuns.organizationId, organizationId),
				gte(payrollRuns.cutoffEnd, opts.from),
				lte(payrollRuns.cutoffEnd, opts.to),
				opts.includeDrafts ? undefined : inArray(payrollBatches.status, ['locked', 'released']),
				opts.establishmentId ? eq(payrollRunLines.establishmentId, opts.establishmentId) : undefined
			)
		);

	const total = emptyTotals();
	const est = new Map<string, PayrollTotals>();
	const dept = new Map<string, PayrollTotals>();
	const people = { total: new Set<string>(), est: new Map<string, Set<string>>(), dept: new Map<string, Set<string>>() };
	let draftLines = 0;

	const add = (t: PayrollTotals, r: (typeof rows)[number]) => {
		const l = r.line;
		const e = (l.earnings ?? {}) as Record<string, number>;
		const d = (l.deductions ?? {}) as Record<string, number>;
		const er = (l.employerContributions ?? {}) as Record<string, number>;
		t.payslips += 1;
		t.gross += l.grossCentavos;
		t.net += l.netPayCentavos;
		for (const k of EARNING_KEYS) t.earnings[k] += e[k] ?? 0;
		for (const k of DEDUCTION_KEYS) t.deductions[k] += d[k] ?? 0;
		for (const k of EMPLOYER_KEYS) t.employer[k] += er[k] ?? 0;
	};
	const bucket = (m: Map<string, PayrollTotals>, key: string) => m.get(key) ?? m.set(key, emptyTotals()).get(key)!;
	const seen = (m: Map<string, Set<string>>, key: string) => m.get(key) ?? m.set(key, new Set()).get(key)!;

	for (const r of rows) {
		if (r.status === 'draft') draftLines += 1;
		const dName = r.line.department?.trim() || 'No department';
		add(total, r);
		add(bucket(est, r.estName), r);
		add(bucket(dept, dName), r);
		people.total.add(r.line.employeeId);
		seen(people.est, r.estName).add(r.line.employeeId);
		seen(people.dept, dName).add(r.line.employeeId);
	}
	total.people = people.total.size;
	const list = (m: Map<string, PayrollTotals>, p: Map<string, Set<string>>) =>
		[...m.entries()]
			.map(([name, t]) => ({ name, ...t, people: p.get(name)?.size ?? 0 }))
			.sort((a, b) => a.name.localeCompare(b.name));

	return {
		from: opts.from,
		to: opts.to,
		total,
		byEstablishment: list(est, people.est),
		byDepartment: list(dept, people.dept),
		draftLines
	};
}

// ---------------------------------------------------------------------------
// 3. Attendance, leave & absenteeism
// ---------------------------------------------------------------------------

export interface AttendanceRow {
	employeeId: string;
	employeeNo: string;
	name: string;
	establishment: string;
	daysWorked: number;
	absences: number;
	lateCount: number;
	lateMinutes: number;
	undertimeMinutes: number;
	overtimeMinutes: number;
	unapprovedOvertimeMinutes: number;
	paidLeaveDays: number;
	unpaidLeaveDays: number;
}

/** Per person over `[from, to]`: attendance from the saved DTR plus approved leave that starts in the range. */
export async function attendanceReport(
	organizationId: string,
	opts: { from: string; to: string; establishmentId?: string | null }
): Promise<{ from: string; to: string; rows: AttendanceRow[]; totals: Omit<AttendanceRow, 'employeeId' | 'employeeNo' | 'name' | 'establishment'> }> {
	const [dtr, leave] = await Promise.all([
		db
			.select({
				employeeId: dtrEntries.employeeId,
				employeeNo: employees.employeeNo,
				first: employees.firstName,
				last: employees.lastName,
				estName: establishments.name,
				worked: dtrEntries.workedMinutes,
				absent: dtrEntries.isAbsent,
				late: dtrEntries.tardinessMinutes,
				under: dtrEntries.undertimeMinutes,
				ot: dtrEntries.otMinutes,
				unOt: dtrEntries.unapprovedOtMinutes
			})
			.from(dtrEntries)
			.innerJoin(employees, eq(employees.id, dtrEntries.employeeId))
			.innerJoin(establishments, eq(establishments.id, dtrEntries.establishmentId))
			.where(
				and(
					eq(employees.organizationId, organizationId),
					isNull(dtrEntries.deletedAt),
					gte(dtrEntries.date, opts.from),
					lte(dtrEntries.date, opts.to),
					opts.establishmentId ? eq(dtrEntries.establishmentId, opts.establishmentId) : undefined
				)
			),
		db
			.select({
				employeeId: leaveRequests.employeeId,
				days: sql<number>`sum(${leaveRequests.days})::float`,
				paid: leaveRequests.paid
			})
			.from(leaveRequests)
			.innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
			.where(
				and(
					eq(employees.organizationId, organizationId),
					eq(leaveRequests.status, 'approved'),
					gte(leaveRequests.startDate, opts.from),
					lte(leaveRequests.startDate, opts.to),
					opts.establishmentId ? eq(leaveRequests.establishmentId, opts.establishmentId) : undefined
				)
			)
			.groupBy(leaveRequests.employeeId, leaveRequests.paid)
	]);

	const map = new Map<string, AttendanceRow>();
	for (const r of dtr) {
		const row =
			map.get(r.employeeId) ??
			({
				employeeId: r.employeeId,
				employeeNo: r.employeeNo,
				name: `${r.last}, ${r.first}`,
				establishment: r.estName,
				daysWorked: 0,
				absences: 0,
				lateCount: 0,
				lateMinutes: 0,
				undertimeMinutes: 0,
				overtimeMinutes: 0,
				unapprovedOvertimeMinutes: 0,
				paidLeaveDays: 0,
				unpaidLeaveDays: 0
			} satisfies AttendanceRow);
		if (r.worked > 0) row.daysWorked += 1;
		if (r.absent) row.absences += 1;
		if (r.late > 0) {
			row.lateCount += 1;
			row.lateMinutes += r.late;
		}
		row.undertimeMinutes += r.under;
		row.overtimeMinutes += r.ot;
		row.unapprovedOvertimeMinutes += r.unOt;
		map.set(r.employeeId, row);
	}
	for (const l of leave) {
		const row = map.get(l.employeeId);
		if (!row) continue; // leave for someone with no DTR rows in range: not listed
		if (l.paid) row.paidLeaveDays += l.days;
		else row.unpaidLeaveDays += l.days;
	}
	const rows = [...map.values()].sort((a, b) => a.establishment.localeCompare(b.establishment) || a.name.localeCompare(b.name));
	const sum = (k: keyof AttendanceRow) => rows.reduce((a, r) => a + (r[k] as number), 0);
	return {
		from: opts.from,
		to: opts.to,
		rows,
		totals: {
			daysWorked: sum('daysWorked'),
			absences: sum('absences'),
			lateCount: sum('lateCount'),
			lateMinutes: sum('lateMinutes'),
			undertimeMinutes: sum('undertimeMinutes'),
			overtimeMinutes: sum('overtimeMinutes'),
			unapprovedOvertimeMinutes: sum('unapprovedOvertimeMinutes'),
			paidLeaveDays: sum('paidLeaveDays'),
			unpaidLeaveDays: sum('unpaidLeaveDays')
		}
	};
}

// ---------------------------------------------------------------------------
// 4. Turnover & attrition
// ---------------------------------------------------------------------------

const VOLUNTARY = new Set(['resigned', 'retired']);

export interface TurnoverReport {
	from: string;
	to: string;
	headcountStart: number;
	headcountEnd: number;
	averageHeadcount: number;
	separated: number;
	voluntary: number;
	involuntary: number;
	byKind: Array<{ kind: string; voluntary: boolean; count: number }>;
	/** Separations ÷ average headcount, as a percentage with one decimal; null when nobody was employed. */
	turnoverRatePct: number | null;
	/** Of those employed at the start, the share still employed at the end. */
	retentionRatePct: number | null;
	averageTenureYears: number | null;
	people: Array<{ employeeNo: string; name: string; kind: string; voluntary: boolean; hiredOn: string; lastDay: string; tenureYears: number }>;
}

/** Separations with a last day in `[from, to]`, headcount at both ends, turnover and retention rates. */
export async function turnoverReport(organizationId: string, opts: { from: string; to: string }): Promise<TurnoverReport> {
	const [emps, seps] = await Promise.all([
		db
			.select({ id: employees.id, hiredOn: employees.hiredOn, separatedOn: employees.separatedOn })
			.from(employees)
			.where(and(eq(employees.organizationId, organizationId), isNull(employees.deletedAt))),
		db
			.select({
				kind: separations.kind,
				lastDay: separations.lastDay,
				employeeNo: employees.employeeNo,
				first: employees.firstName,
				last: employees.lastName,
				hiredOn: employees.hiredOn
			})
			.from(separations)
			.innerJoin(employees, eq(employees.id, separations.employeeId))
			.where(
				and(
					eq(separations.organizationId, organizationId),
					gte(separations.lastDay, opts.from),
					lte(separations.lastDay, opts.to)
				)
			)
	]);
	const employedOn = (date: string) => emps.filter((e) => e.hiredOn <= date && (!e.separatedOn || e.separatedOn >= date));
	const atStart = employedOn(opts.from);
	const atEnd = employedOn(opts.to);
	const stillThere = atStart.filter((e) => !e.separatedOn || e.separatedOn > opts.to).length;
	const average = (atStart.length + atEnd.length) / 2;

	const people = seps
		.map((s) => ({
			employeeNo: s.employeeNo,
			name: `${s.last}, ${s.first}`,
			kind: s.kind,
			voluntary: VOLUNTARY.has(s.kind),
			hiredOn: s.hiredOn,
			lastDay: s.lastDay,
			tenureYears: Math.round((((new Date(`${s.lastDay}T00:00:00Z`).getTime() - new Date(`${s.hiredOn}T00:00:00Z`).getTime()) / 86_400_000) / 365.25) * 10) / 10
		}))
		.sort((a, b) => a.lastDay.localeCompare(b.lastDay));
	const byKind = [...new Set(people.map((p) => p.kind))].map((kind) => ({
		kind,
		voluntary: VOLUNTARY.has(kind),
		count: people.filter((p) => p.kind === kind).length
	}));
	const voluntary = people.filter((p) => p.voluntary).length;
	return {
		from: opts.from,
		to: opts.to,
		headcountStart: atStart.length,
		headcountEnd: atEnd.length,
		averageHeadcount: Math.round(average * 10) / 10,
		separated: people.length,
		voluntary,
		involuntary: people.length - voluntary,
		byKind,
		turnoverRatePct: average > 0 ? Math.round((people.length / average) * 1000) / 10 : null,
		retentionRatePct: atStart.length > 0 ? Math.round((stillThere / atStart.length) * 1000) / 10 : null,
		averageTenureYears: people.length ? Math.round((people.reduce((a, p) => a + p.tenureYears, 0) / people.length) * 10) / 10 : null,
		people
	};
}
