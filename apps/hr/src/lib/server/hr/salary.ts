import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { employees, payrollBatches, payrollRunLines, payrollRuns, salaryHistory, users } from '$lib/server/db/schema/index';
import { businessDateFor } from '$lib/server/time';

export class SalaryError extends Error {}

const TZ = 'Asia/Manila';
export const PAY_BASES = ['monthly', 'daily', 'hourly'] as const;
export type PayBasis = (typeof PAY_BASES)[number];
export const BASIS_LABEL: Record<PayBasis, string> = { monthly: 'month', daily: 'day', hourly: 'hour' };

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

export interface Entry {
	effectiveFrom: string;
	payBasis: string;
	baseRateCentavos: number;
	/** What this entry replaced — lets the rate before the first entry be known even without a starting row. */
	previousPayBasis?: string | null;
	previousRateCentavos?: number | null;
}

export interface RateSegment {
	start: string;
	end: string;
	baseRateCentavos: number;
}

export interface PayTerms {
	payBasis: PayBasis;
	/** The rate on the cutoff's last day. */
	baseRateCentavos: number;
	/** Only when the rate changes inside the cutoff. */
	segments: RateSegment[] | null;
	/** For the payslip note. */
	changes: Array<{ date: string; fromCentavos: number; toCentavos: number }>;
	/** A change of pay basis inside the cutoff waits for the next one; the date it will take effect. */
	deferredBasisChange: string | null;
}

const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * What a person is paid on in one cutoff. A rate change inside the cutoff splits it by day. A change
 * of pay basis inside it does not (a day-by-day mix of two bases cannot be read on a payslip): the old
 * basis stays for this cutoff and the new one starts with the next.
 */
export function payTermsFor(history: Entry[], cutoffStart: string, cutoffEnd: string, fallback: Entry): PayTerms {
	const sorted = [...history].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
	const inForce = (date: string): Entry => {
		const hit = [...sorted].reverse().find((e) => e.effectiveFrom <= date);
		if (hit) return hit;
		const first = sorted[0];
		if (first?.previousRateCentavos != null && first.previousPayBasis) {
			return { effectiveFrom: '0000-00-00', payBasis: first.previousPayBasis, baseRateCentavos: first.previousRateCentavos };
		}
		return first ?? fallback;
	};

	const start = inForce(cutoffStart);
	const basis = start.payBasis as PayBasis;
	const segments: RateSegment[] = [{ start: cutoffStart, end: cutoffEnd, baseRateCentavos: start.baseRateCentavos }];
	const changes: PayTerms['changes'] = [];
	let deferred: string | null = null;

	for (const e of sorted) {
		if (e.effectiveFrom <= cutoffStart || e.effectiveFrom > cutoffEnd) continue;
		if (e.payBasis !== basis) {
			deferred = e.effectiveFrom;
			continue;
		}
		const last = segments[segments.length - 1]!;
		if (e.baseRateCentavos === last.baseRateCentavos) continue;
		last.end = dayBefore(e.effectiveFrom);
		segments.push({ start: e.effectiveFrom, end: cutoffEnd, baseRateCentavos: e.baseRateCentavos });
		changes.push({ date: e.effectiveFrom, fromCentavos: last.baseRateCentavos, toCentavos: e.baseRateCentavos });
	}

	return {
		payBasis: basis,
		baseRateCentavos: segments[segments.length - 1]!.baseRateCentavos,
		segments: segments.length > 1 ? segments : null,
		changes,
		deferredBasisChange: deferred
	};
}

export const adjustSchema = z.object({
	employeeId: z.string().uuid(),
	payBasis: z.enum(PAY_BASES, { message: 'Pick the pay basis.' }),
	rate: z.coerce.number().positive('Enter the new rate.').max(100_000_000),
	effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the effective date.'),
	remarks: z.string().trim().min(3, 'Say why the salary is being adjusted.').max(500)
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** History for several people, oldest first. */
export async function historiesFor(employeeIds: string[]): Promise<Map<string, Entry[]>> {
	const out = new Map<string, Entry[]>();
	if (employeeIds.length === 0) return out;
	const rows = await db
		.select({
			employeeId: salaryHistory.employeeId,
			effectiveFrom: salaryHistory.effectiveFrom,
			payBasis: salaryHistory.payBasis,
			baseRateCentavos: salaryHistory.baseRateCentavos,
			previousPayBasis: salaryHistory.previousPayBasis,
			previousRateCentavos: salaryHistory.previousRateCentavos
		})
		.from(salaryHistory)
		.where(inArray(salaryHistory.employeeId, employeeIds))
		.orderBy(asc(salaryHistory.effectiveFrom));
	for (const r of rows) {
		const list = out.get(r.employeeId) ?? [];
		list.push({
			effectiveFrom: r.effectiveFrom,
			payBasis: r.payBasis,
			baseRateCentavos: r.baseRateCentavos,
			previousPayBasis: r.previousPayBasis,
			previousRateCentavos: r.previousRateCentavos
		});
		out.set(r.employeeId, list);
	}
	return out;
}

/** Salary history for several people, newest first, with the movement worked out. */
export async function listHistories(employeeIds: string[]) {
	const out: Record<string, Awaited<ReturnType<typeof rowsFor>>> = {};
	if (employeeIds.length === 0) return out;
	const rows = await rowsFor(employeeIds);
	for (const r of rows) (out[r.employeeId] ??= []).push(r);
	return out;
}

export async function listHistory(employeeId: string) {
	return (await listHistories([employeeId]))[employeeId] ?? [];
}

async function rowsFor(employeeIds: string[]) {
	const rows = await db
		.select({
			id: salaryHistory.id,
			employeeId: salaryHistory.employeeId,
			effectiveFrom: salaryHistory.effectiveFrom,
			payBasis: salaryHistory.payBasis,
			baseRateCentavos: salaryHistory.baseRateCentavos,
			previousPayBasis: salaryHistory.previousPayBasis,
			previousRateCentavos: salaryHistory.previousRateCentavos,
			remarks: salaryHistory.remarks,
			createdAt: salaryHistory.createdAt,
			by: users.name
		})
		.from(salaryHistory)
		.leftJoin(users, eq(users.id, salaryHistory.createdByUserId))
		.where(inArray(salaryHistory.employeeId, employeeIds))
		.orderBy(asc(salaryHistory.employeeId), desc(salaryHistory.effectiveFrom));
	const today = businessDateFor(TZ);
	// The entry in force today is the newest one that has already started, per person.
	const currentOf = new Map<string, string>();
	for (const r of rows) if (r.effectiveFrom <= today && !currentOf.has(r.employeeId)) currentOf.set(r.employeeId, r.id);
	return rows.map((r) => ({
		...r,
		change: r.previousRateCentavos === null ? null : r.baseRateCentavos - r.previousRateCentavos,
		percent:
			r.previousRateCentavos && r.previousPayBasis === r.payBasis
				? ((r.baseRateCentavos - r.previousRateCentavos) / r.previousRateCentavos) * 100
				: null,
		isCurrent: currentOf.get(r.employeeId) === r.id,
		isFuture: r.effectiveFrom > today
	}));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Makes each employee's own rate the one in force today, so lists and exports are right. */
export async function syncCurrentRates(organizationId: string) {
	const today = businessDateFor(TZ);
	await db.execute(sql`
		update employees e
		set pay_basis = h.pay_basis, base_rate_centavos = h.base_rate_centavos, updated_at = now()
		from (
			select distinct on (employee_id) employee_id, pay_basis, base_rate_centavos
			from salary_history
			where effective_from <= ${today}
			order by employee_id, effective_from desc
		) h
		where e.id = h.employee_id
			and e.organization_id = ${organizationId}
			and (e.pay_basis <> h.pay_basis or e.base_rate_centavos <> h.base_rate_centavos)
	`);
}

export async function adjustSalary(organizationId: string, input: z.infer<typeof adjustSchema>, userId: string | null) {
	const emp = await db
		.select()
		.from(employees)
		.where(and(eq(employees.id, input.employeeId), eq(employees.organizationId, organizationId)))
		.then((r) => r.at(0));
	if (!emp || emp.deletedAt) throw new SalaryError('That person does not exist.');
	if (input.effectiveFrom < emp.hiredOn) throw new SalaryError(`That is before they were hired (${emp.hiredOn}).`);

	const history = await db.select().from(salaryHistory).where(eq(salaryHistory.employeeId, emp.id)).orderBy(asc(salaryHistory.effectiveFrom));
	if (history.some((h) => h.effectiveFrom === input.effectiveFrom)) {
		throw new SalaryError('There is already an adjustment on that date. Pick a different effective date.');
	}
	const before = [...history].reverse().find((h) => h.effectiveFrom < input.effectiveFrom);
	const prev = before ?? { payBasis: emp.payBasis, baseRateCentavos: emp.baseRateCentavos };
	const rate = Math.round(input.rate * 100);
	if (rate === prev.baseRateCentavos && input.payBasis === prev.payBasis) {
		throw new SalaryError('That is the same as the salary in force on that date.');
	}

	const [row] = await db
		.insert(salaryHistory)
		.values({
			employeeId: emp.id,
			effectiveFrom: input.effectiveFrom,
			payBasis: input.payBasis,
			baseRateCentavos: rate,
			previousPayBasis: prev.payBasis,
			previousRateCentavos: prev.baseRateCentavos,
			remarks: input.remarks,
			createdByUserId: userId
		})
		.returning();
	await syncCurrentRates(organizationId);

	// Payslips already locked for a period on/after the effective date keep their snapshot.
	const locked = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(payrollRunLines)
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
		.where(
			and(
				eq(payrollRunLines.employeeId, emp.id),
				inArray(payrollBatches.status, ['locked', 'released']),
				sql`${payrollRuns.cutoffEnd} >= ${input.effectiveFrom}`
			)
		)
		.then((r) => r[0]!.n);
	return { entry: row!, lockedPayslipsAffected: locked, previous: prev };
}
