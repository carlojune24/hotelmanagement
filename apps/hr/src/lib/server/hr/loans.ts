import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	employeeLoans,
	employees,
	loanTypes,
	payrollBatches,
	payrollLoanDeductions,
	payrollRunLines,
	payrollRuns,
	type EmployeeLoan
} from '$lib/server/db/schema/index';

export class LoanError extends Error {}

// ---------------------------------------------------------------------------
// Types — Main HR's list (HR → Settings); the six below are only the starting set
// ---------------------------------------------------------------------------

export type RemitTo = 'sss' | 'pagibig' | 'none';
export const REMIT_TO_LABEL: Record<RemitTo, string> = {
	sss: 'SSS loans schedule',
	pagibig: 'Pag-IBIG loans schedule',
	none: 'Not remitted (company-side)'
};
export type LoanAgency = 'sss_loan' | 'pagibig_loan';
export const agencyOfRemit = (r: string): LoanAgency | null =>
	r === 'sss' ? 'sss_loan' : r === 'pagibig' ? 'pagibig_loan' : null;

const DEFAULT_TYPES: Array<{ key: string; name: string; remitTo: RemitTo }> = [
	{ key: 'sss_salary', name: 'SSS salary loan', remitTo: 'sss' },
	{ key: 'sss_calamity', name: 'SSS calamity loan', remitTo: 'sss' },
	{ key: 'pagibig_mpl', name: 'Pag-IBIG multi-purpose loan', remitTo: 'pagibig' },
	{ key: 'pagibig_calamity', name: 'Pag-IBIG calamity loan', remitTo: 'pagibig' },
	{ key: 'pagibig_housing', name: 'Pag-IBIG housing loan', remitTo: 'pagibig' },
	{ key: 'company', name: 'Company loan', remitTo: 'none' }
];

/** Government loans are taken out of pay before others when pay falls short; ties fall back to the id. */
const rankOf = (agency: string | null) => (agency ? 0 : 1);
export const byPriority = (
	a: { agency: string | null; loanId: string },
	b: { agency: string | null; loanId: string }
) => rankOf(a.agency) - rankOf(b.agency) || a.loanId.localeCompare(b.loanId);

export async function listLoanTypes(organizationId: string) {
	let rows = await db.select().from(loanTypes).where(eq(loanTypes.organizationId, organizationId));
	if (rows.length === 0) {
		await db
			.insert(loanTypes)
			.values(DEFAULT_TYPES.map((t) => ({ organizationId, ...t })))
			.onConflictDoNothing();
		rows = await db.select().from(loanTypes).where(eq(loanTypes.organizationId, organizationId));
	}
	const used = await db
		.select({ kind: employeeLoans.kind, n: sql<number>`count(*)::int` })
		.from(employeeLoans)
		.where(eq(employeeLoans.organizationId, organizationId))
		.groupBy(employeeLoans.kind);
	const count = new Map(used.map((u) => [u.kind, u.n]));
	return rows
		.map((r) => ({ ...r, remitTo: r.remitTo as RemitTo, loanCount: count.get(r.key) ?? 0 }))
		.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

export const loanTypeSchema = z.object({
	name: z.string().trim().min(2, 'Give the loan type a name.').max(80),
	remitTo: z.enum(['sss', 'pagibig', 'none'])
});

const keyOf = (name: string) =>
	'custom_' +
	name
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 40);

export async function createLoanType(organizationId: string, input: z.infer<typeof loanTypeSchema>) {
	const existing = await listLoanTypes(organizationId);
	if (existing.some((t) => t.name.toLowerCase() === input.name.toLowerCase())) {
		throw new LoanError('A loan type with that name already exists.');
	}
	let key = keyOf(input.name);
	const taken = new Set(existing.map((t) => t.key));
	for (let n = 2; taken.has(key); n++) key = `${keyOf(input.name)}_${n}`;
	const [row] = await db.insert(loanTypes).values({ organizationId, key, name: input.name, remitTo: input.remitTo }).returning();
	return row!;
}

export async function updateLoanType(
	organizationId: string,
	id: string,
	input: z.infer<typeof loanTypeSchema> & { active: boolean }
) {
	const current = await db
		.select()
		.from(loanTypes)
		.where(and(eq(loanTypes.id, id), eq(loanTypes.organizationId, organizationId)))
		.then((r) => r.at(0));
	if (!current) throw new LoanError('That loan type does not exist.');
	const others = await listLoanTypes(organizationId);
	if (others.some((t) => t.id !== id && t.name.toLowerCase() === input.name.toLowerCase())) {
		throw new LoanError('A loan type with that name already exists.');
	}
	const [row] = await db
		.update(loanTypes)
		.set({ name: input.name, remitTo: input.remitTo, active: input.active, updatedAt: new Date() })
		.where(eq(loanTypes.id, id))
		.returning();
	return { before: current, after: row! };
}

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

/** A cutoff ending on the 16th or later is the month's second half; a monthly run takes the whole amount. */
export const isSecondHalf = (cutoffEnd: string) => Number(cutoffEnd.slice(8, 10)) >= 16;

/** This cutoff's share of a monthly amortization. The odd centavo lands in the second half. */
export function scheduledShare(amortizationCentavos: number, frequency: 'semi_monthly' | 'monthly', secondHalf: boolean): number {
	if (frequency === 'monthly') return amortizationCentavos;
	const first = Math.floor(amortizationCentavos / 2);
	return secondHalf ? amortizationCentavos - first : first;
}

/** What is due now: this cutoff's share plus anything carried from a short cutoff, never above the balance. */
export function dueNow(input: { scheduled: number; carried: number; remaining: number }): number {
	return Math.max(0, Math.min(input.scheduled + input.carried, input.remaining));
}

/** Fills `dues` in order from `available` pay; whatever pay cannot cover is left for the next cutoff. */
export function allocate(dues: number[], available: number): number[] {
	let left = Math.max(0, available);
	return dues.map((d) => {
		const take = Math.min(d, left);
		left -= take;
		return take;
	});
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

const pesos = z.coerce.number().positive('Enter an amount above zero.').max(100_000_000);

export const loanFormSchema = z.object({
	employeeId: z.string().uuid('Pick the employee.'),
	kind: z.string().trim().min(1, 'Pick the loan type.'),
	referenceNo: z.string().trim().max(60).optional(),
	principal: pesos,
	amortization: pesos,
	startPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick the first month it is deducted.'),
	note: z.string().trim().max(500).optional()
});

export const loanEditSchema = z.object({
	loanId: z.string().uuid(),
	referenceNo: z.string().trim().max(60).optional(),
	amortization: pesos,
	note: z.string().trim().max(500).optional()
});

const centavos = (p: number) => Math.round(p * 100);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Deductions that count: on a locked or released batch. */
const finalOnly = inArray(payrollBatches.status, ['locked', 'released']);

async function deductedByLoan(loanIds: string[]): Promise<Map<string, number>> {
	if (loanIds.length === 0) return new Map();
	const rows = await db
		.select({ loanId: payrollLoanDeductions.loanId, total: sql<number>`coalesce(sum(${payrollLoanDeductions.deductedCentavos}), 0)::bigint` })
		.from(payrollLoanDeductions)
		.innerJoin(payrollRunLines, eq(payrollRunLines.id, payrollLoanDeductions.lineId))
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.where(and(inArray(payrollLoanDeductions.loanId, loanIds), finalOnly))
		.groupBy(payrollLoanDeductions.loanId);
	return new Map(rows.map((r) => [r.loanId, Number(r.total)]));
}

export interface LoanRow extends EmployeeLoan {
	employeeName: string;
	employeeNo: string;
	deductedCentavos: number;
	balanceCentavos: number;
}

export async function listLoans(organizationId: string): Promise<LoanRow[]> {
	const rows = await db
		.select({ loan: employeeLoans, last: employees.lastName, first: employees.firstName, no: employees.employeeNo })
		.from(employeeLoans)
		.innerJoin(employees, eq(employees.id, employeeLoans.employeeId))
		.where(eq(employeeLoans.organizationId, organizationId))
		.orderBy(asc(employees.lastName), asc(employees.firstName), desc(employeeLoans.createdAt));
	const deducted = await deductedByLoan(rows.map((r) => r.loan.id));
	return rows.map((r) => {
		const d = deducted.get(r.loan.id) ?? 0;
		return {
			...r.loan,
			employeeName: `${r.last}, ${r.first}`,
			employeeNo: r.no,
			deductedCentavos: d,
			balanceCentavos: Math.max(0, r.loan.principalCentavos - d)
		};
	});
}

/** Every payslip that touched a loan, newest first — what was due, taken and carried. */
export async function loanHistory(loanId: string) {
	return db
		.select({
			cutoffStart: payrollRuns.cutoffStart,
			cutoffEnd: payrollRuns.cutoffEnd,
			status: payrollBatches.status,
			dueCentavos: payrollLoanDeductions.dueCentavos,
			deductedCentavos: payrollLoanDeductions.deductedCentavos
		})
		.from(payrollLoanDeductions)
		.innerJoin(payrollRunLines, eq(payrollRunLines.id, payrollLoanDeductions.lineId))
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
		.where(eq(payrollLoanDeductions.loanId, loanId))
		.orderBy(desc(payrollRuns.cutoffStart));
}

/** People who can take a loan: anyone not soft-deleted. */
export async function loanableEmployees(organizationId: string) {
	const rows = await db
		.select({ id: employees.id, last: employees.lastName, first: employees.firstName, no: employees.employeeNo })
		.from(employees)
		.where(and(eq(employees.organizationId, organizationId), sql`${employees.deletedAt} is null`))
		.orderBy(asc(employees.lastName), asc(employees.firstName));
	return rows.map((r) => ({ id: r.id, name: `${r.last}, ${r.first}`, employeeNo: r.no }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createLoan(organizationId: string, input: z.infer<typeof loanFormSchema>, userId: string | null) {
	const principal = centavos(input.principal);
	const amortization = centavos(input.amortization);
	if (amortization > principal) throw new LoanError('The monthly amount is more than the loan itself.');
	const type = await db
		.select()
		.from(loanTypes)
		.where(and(eq(loanTypes.organizationId, organizationId), eq(loanTypes.key, input.kind)))
		.then((r) => r.at(0));
	if (!type || !type.active) throw new LoanError('Pick an active loan type.');
	const person = await db
		.select({ id: employees.id })
		.from(employees)
		.where(and(eq(employees.id, input.employeeId), eq(employees.organizationId, organizationId)))
		.then((r) => r.at(0));
	if (!person) throw new LoanError('That employee does not exist.');
	const [row] = await db
		.insert(employeeLoans)
		.values({
			organizationId,
			employeeId: input.employeeId,
			kind: input.kind,
			referenceNo: input.referenceNo || null,
			principalCentavos: principal,
			amortizationCentavos: amortization,
			startPeriod: input.startPeriod,
			note: input.note || null,
			createdByUserId: userId
		})
		.returning();
	return row!;
}

async function getLoan(organizationId: string, loanId: string) {
	const row = await db
		.select()
		.from(employeeLoans)
		.where(and(eq(employeeLoans.id, loanId), eq(employeeLoans.organizationId, organizationId)))
		.then((r) => r.at(0));
	if (!row) throw new LoanError('That loan does not exist.');
	return row;
}

export async function editLoan(organizationId: string, input: z.infer<typeof loanEditSchema>) {
	const loan = await getLoan(organizationId, input.loanId);
	if (loan.status === 'paid_off' || loan.status === 'cancelled') throw new LoanError('A closed loan cannot be edited.');
	const amortization = centavos(input.amortization);
	if (amortization > loan.principalCentavos) throw new LoanError('The monthly amount is more than the loan itself.');
	const [row] = await db
		.update(employeeLoans)
		.set({ amortizationCentavos: amortization, referenceNo: input.referenceNo || null, note: input.note || null, updatedAt: new Date() })
		.where(eq(employeeLoans.id, loan.id))
		.returning();
	return { before: loan, after: row! };
}

export const statusSchema = z.object({
	loanId: z.string().uuid(),
	to: z.enum(['active', 'paused', 'paid_off', 'cancelled']),
	note: z.string().trim().max(500).optional()
});

export async function setLoanStatus(organizationId: string, input: z.infer<typeof statusSchema>) {
	const loan = await getLoan(organizationId, input.loanId);
	if (loan.status === 'paid_off' || loan.status === 'cancelled') throw new LoanError('This loan is already closed.');
	if ((input.to === 'cancelled' || input.to === 'paid_off') && !input.note) {
		throw new LoanError('Say why it is being closed — the reason is kept with the loan.');
	}
	if (input.to === loan.status) return loan;
	const [row] = await db
		.update(employeeLoans)
		.set({ status: input.to, statusNote: input.note || null, updatedAt: new Date() })
		.where(eq(employeeLoans.id, loan.id))
		.returning();
	return row!;
}

// ---------------------------------------------------------------------------
// Payroll hook — what each person owes in this cutoff
// ---------------------------------------------------------------------------

export interface LoanDue {
	loanId: string;
	kind: string;
	label: string;
	/** The remittance schedule it lands on; null for a loan that is not remitted. */
	agency: LoanAgency | null;
	referenceNo: string | null;
	due: number;
}

/**
 * The loans due in a run, per employee. Balance and carried shortfall come only from *other* runs' locked or
 * released batches, so regenerating a draft never counts its own earlier attempt.
 */
export async function loansDueFor(
	run: { id: string; organizationId: string; cutoffStart: string; cutoffEnd: string; payDate: string; frequency: string },
	employeeIds: string[]
): Promise<Map<string, LoanDue[]>> {
	const out = new Map<string, LoanDue[]>();
	if (employeeIds.length === 0) return out;
	const payMonth = run.payDate.slice(0, 7);
	const loans = await db
		.select()
		.from(employeeLoans)
		.where(
			and(
				inArray(employeeLoans.employeeId, employeeIds),
				eq(employeeLoans.status, 'active'),
				eq(employeeLoans.organizationId, run.organizationId),
				sql`${employeeLoans.startPeriod} <= ${payMonth}`
			)
		);
	if (loans.length === 0) return out;

	const typeByKey = new Map((await listLoanTypes(run.organizationId)).map((t) => [t.key, t]));
	const ids = loans.map((l) => l.id);
	const prior = await db
		.select({
			loanId: payrollLoanDeductions.loanId,
			cutoffStart: payrollRuns.cutoffStart,
			due: payrollLoanDeductions.dueCentavos,
			deducted: payrollLoanDeductions.deductedCentavos
		})
		.from(payrollLoanDeductions)
		.innerJoin(payrollRunLines, eq(payrollRunLines.id, payrollLoanDeductions.lineId))
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
		.where(and(inArray(payrollLoanDeductions.loanId, ids), finalOnly, ne(payrollRuns.id, run.id)));
	// Every other final row counts toward the balance; only an earlier cutoff's shortfall is carried forward.
	const paidBefore = new Map<string, number>();
	const latest = new Map<string, { start: string; shortfall: number }>();
	for (const p of prior) {
		paidBefore.set(p.loanId, (paidBefore.get(p.loanId) ?? 0) + p.deducted);
		const cur = latest.get(p.loanId);
		if (p.cutoffStart >= run.cutoffStart) continue;
		if (!cur || p.cutoffStart > cur.start) latest.set(p.loanId, { start: p.cutoffStart, shortfall: p.due - p.deducted });
	}

	const frequency = run.frequency === 'monthly' ? 'monthly' : 'semi_monthly';
	const second = isSecondHalf(run.cutoffEnd);
	for (const l of loans) {
		const remaining = l.principalCentavos - (paidBefore.get(l.id) ?? 0);
		const due = dueNow({
			scheduled: scheduledShare(l.amortizationCentavos, frequency, second),
			carried: latest.get(l.id)?.shortfall ?? 0,
			remaining
		});
		if (due <= 0) continue;
		const list = out.get(l.employeeId) ?? [];
		const type = typeByKey.get(l.kind);
		list.push({
			loanId: l.id,
			kind: l.kind,
			label: type?.name ?? l.kind,
			agency: agencyOfRemit(type?.remitTo ?? 'none'),
			referenceNo: l.referenceNo,
			due
		});
		out.set(l.employeeId, list);
	}
	for (const list of out.values()) list.sort(byPriority);
	return out;
}

/** Closes any loan whose balance is now zero — called when a batch is locked. */
export async function closeSettledLoans(batchId: string) {
	const rows = await db
		.select({ loanId: payrollLoanDeductions.loanId })
		.from(payrollLoanDeductions)
		.innerJoin(payrollRunLines, eq(payrollRunLines.id, payrollLoanDeductions.lineId))
		.where(eq(payrollRunLines.batchId, batchId));
	const ids = [...new Set(rows.map((r) => r.loanId))];
	if (ids.length === 0) return;
	const loans = await db.select().from(employeeLoans).where(and(inArray(employeeLoans.id, ids), eq(employeeLoans.status, 'active')));
	const deducted = await deductedByLoan(loans.map((l) => l.id));
	const settled = loans.filter((l) => (deducted.get(l.id) ?? 0) >= l.principalCentavos).map((l) => l.id);
	if (settled.length) {
		await db
			.update(employeeLoans)
			.set({ status: 'paid_off', statusNote: 'Fully deducted through payroll.', updatedAt: new Date() })
			.where(inArray(employeeLoans.id, settled));
	}
}

/** The reverse of closeSettledLoans: unlocking a batch can make a "paid off" loan owe again. */
export async function reopenSettledLoans(batchId: string) {
	const rows = await db
		.select({ loanId: payrollLoanDeductions.loanId })
		.from(payrollLoanDeductions)
		.innerJoin(payrollRunLines, eq(payrollRunLines.id, payrollLoanDeductions.lineId))
		.where(eq(payrollRunLines.batchId, batchId));
	const ids = [...new Set(rows.map((r) => r.loanId))];
	if (ids.length === 0) return;
	const loans = await db
		.select()
		.from(employeeLoans)
		.where(and(inArray(employeeLoans.id, ids), eq(employeeLoans.status, 'paid_off'), eq(employeeLoans.statusNote, 'Fully deducted through payroll.')));
	const deducted = await deductedByLoan(loans.map((l) => l.id));
	const owing = loans.filter((l) => (deducted.get(l.id) ?? 0) < l.principalCentavos).map((l) => l.id);
	if (owing.length) {
		await db.update(employeeLoans).set({ status: 'active', statusNote: null, updatedAt: new Date() }).where(inArray(employeeLoans.id, owing));
	}
}
