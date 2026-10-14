import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { employees, payrollBatches, payrollRunLines, payrollRuns } from '$lib/server/db/schema/index';

/**
 * 13th-month pay under Presidential Decree 851: one twelfth of the basic salary actually earned in
 * the calendar year, for rank-and-file employees who worked at least one month of it. Managerial
 * employees are not covered. Overtime, premiums, allowances and night differential are not basic;
 * pay lost to absence, late and undertime is not earned. A person who separates is paid the pro-rated
 * amount (basic earned up to their last day).
 */

/** An employee must have served this many calendar days of the year to be entitled ("at least one month"). */
export const MIN_SERVICE_DAYS = 30;

/** Income-tax exemption for the 13th month and other benefits combined (TRAIN law), per year. */
export const TAX_EXEMPT_CENTAVOS = 9_000_000;

export interface ThirteenthBase {
	/** Final payslips only (locked or released). */
	basicEarned: number;
	lateDeductions: number;
}

/** Whole calendar days from `a` to `b` inclusive (YYYY-MM-DD); 0 when `b` is before `a`. */
export function inclusiveDays(a: string, b: string): number {
	const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
	return Math.max(0, Math.round(ms / 86_400_000) + 1);
}

export function amountFor(base: ThirteenthBase): number {
	return Math.round(Math.max(0, base.basicEarned - base.lateDeductions) / 12);
}

export type NotEntitled = 'not_covered' | 'under_one_month' | 'nothing_earned';

export interface ThirteenthResult {
	year: number;
	through: string;
	entitled: boolean;
	reason: NotEntitled | null;
	/** Why, when not covered (Main HR's note). */
	note: string | null;
	serviceDays: number;
	basicEarned: number;
	lateDeductions: number;
	/** `(basic earned − late/undertime) ÷ 12`. */
	amount: number;
	/** Payslips of the year still in draft — their pay is not counted yet. */
	draftPayslips: number;
	finalPayslips: number;
}

/** Computes an employee's 13th month for `year`, counting final payslips whose cutoff began on or before `through`. */
export async function thirteenthMonthFor(employeeId: string, year: number, through: string): Promise<ThirteenthResult> {
	const emp = await db.select().from(employees).where(eq(employees.id, employeeId)).then((r) => r.at(0));
	if (!emp) throw new Error('That person does not exist.');
	const yearStart = `${year}-01-01`;
	const yearEnd = `${year}-12-31`;
	const upTo = through < yearEnd ? through : yearEnd;

	const sums = (statuses: string[]) =>
		db
			.select({
				basic: sql<number>`coalesce(sum((${payrollRunLines.earnings}->>'basic')::bigint), 0)::bigint`,
				late: sql<number>`coalesce(sum((${payrollRunLines.deductions}->>'tardiness_undertime')::bigint), 0)::bigint`,
				n: sql<number>`count(*)::int`
			})
			.from(payrollRunLines)
			.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
			.innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
			.where(
				and(
					eq(payrollRunLines.employeeId, employeeId),
					inArray(payrollBatches.status, statuses),
					gte(payrollRuns.cutoffEnd, yearStart),
					// A cutoff counts if it began on or before `through`: someone leaving mid-cutoff is paid for that
					// cutoff up to their last day, so its payslip must be in. A cutoff ending next year is next year's.
					lte(payrollRuns.cutoffStart, upTo),
					lte(payrollRuns.cutoffEnd, yearEnd)
				)
			)
			.then((r) => r[0]!);
	const [final, draft] = await Promise.all([sums(['locked', 'released']), sums(['draft'])]);

	const serviceFrom = emp.hiredOn > yearStart ? emp.hiredOn : yearStart;
	const serviceDays = inclusiveDays(serviceFrom, upTo);
	const base: ThirteenthBase = { basicEarned: Number(final.basic), lateDeductions: Number(final.late) };
	const amount = amountFor(base);

	let reason: NotEntitled | null = null;
	if (!emp.thirteenthMonthCovered) reason = 'not_covered';
	else if (serviceDays < MIN_SERVICE_DAYS) reason = 'under_one_month';
	else if (amount === 0) reason = 'nothing_earned';

	return {
		year,
		through: upTo,
		entitled: reason === null,
		reason,
		note: emp.thirteenthMonthNote,
		serviceDays,
		basicEarned: base.basicEarned,
		lateDeductions: base.lateDeductions,
		amount: reason === 'not_covered' || reason === 'under_one_month' ? 0 : amount,
		draftPayslips: draft.n,
		finalPayslips: final.n
	};
}

export async function setThirteenthMonthCovered(
	organizationId: string,
	employeeId: string,
	covered: boolean,
	note: string | null
) {
	const [row] = await db
		.update(employees)
		.set({ thirteenthMonthCovered: covered, thirteenthMonthNote: covered ? null : note, updatedAt: new Date() })
		.where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)))
		.returning({ id: employees.id });
	return !!row;
}
