import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { businessDateFor } from '$lib/server/time';
import { deleteLoanDocument, saveLoanDocument } from '$lib/server/uploads';
import {
	employeeLoanDocuments,
	employeeLoanPayments,
	employeeLoanSkips,
	employeeLoans,
	employees,
	loanTypes,
	payrollBatches,
	payrollLoanDeductions,
	payrollRunLines,
	payrollRuns,
	users,
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
/** Blank means nothing was paid before. */
const priorPesos = z.coerce.number().min(0, 'Already paid cannot be negative.').max(100_000_000).optional();
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const blankToUndefined = (v: unknown) => (v === '' ? undefined : v);
const optDate = z.preprocess(blankToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.').optional());
const optMonths = z.preprocess(blankToUndefined, z.coerce.number().int().min(1, 'Term is at least 1 month.').max(600).optional());

export const loanFormSchema = z.object({
	employeeId: z.string().uuid('Pick the employee.'),
	kind: z.string().trim().min(1, 'Pick the loan type.'),
	referenceNo: z.string().trim().max(60).optional(),
	principal: pesos,
	amortization: pesos,
	alreadyPaid: priorPesos,
	startPeriod: z.string().regex(MONTH, 'Pick the first month it is deducted.'),
	releasedOn: optDate,
	termMonths: optMonths,
	note: z.string().trim().max(500).optional()
});

export const loanEditSchema = z.object({
	loanId: z.string().uuid(),
	referenceNo: z.string().trim().max(60).optional(),
	amortization: pesos,
	alreadyPaid: priorPesos,
	/** Only sent while no locked payslip has deducted the loan; absent = unchanged. */
	principal: pesos.optional(),
	startPeriod: z.string().regex(MONTH, 'Pick the first month it is deducted.').optional(),
	releasedOn: optDate,
	termMonths: optMonths,
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

/** Money received against a loan outside payroll (cash, transfer), not voided. */
async function paidOutsideByLoan(loanIds: string[]): Promise<Map<string, number>> {
	if (loanIds.length === 0) return new Map();
	const rows = await db
		.select({ loanId: employeeLoanPayments.loanId, total: sql<number>`coalesce(sum(${employeeLoanPayments.amountCentavos}), 0)::bigint` })
		.from(employeeLoanPayments)
		.where(and(inArray(employeeLoanPayments.loanId, loanIds), sql`${employeeLoanPayments.voidedAt} is null`))
		.groupBy(employeeLoanPayments.loanId);
	return new Map(rows.map((r) => [r.loanId, Number(r.total)]));
}

export interface LoanRow extends EmployeeLoan {
	employeeName: string;
	employeeNo: string;
	employeeStatus: string;
	separatedOn: string | null;
	/** Taken by locked or released payslips. */
	deductedCentavos: number;
	/** Received outside payroll. */
	paidOutsideCentavos: number;
	balanceCentavos: number;
}

export async function listLoans(organizationId: string): Promise<LoanRow[]> {
	const rows = await db
		.select({
			loan: employeeLoans,
			last: employees.lastName,
			first: employees.firstName,
			no: employees.employeeNo,
			status: employees.status,
			separatedOn: employees.separatedOn
		})
		.from(employeeLoans)
		.innerJoin(employees, eq(employees.id, employeeLoans.employeeId))
		.where(eq(employeeLoans.organizationId, organizationId))
		.orderBy(asc(employees.lastName), asc(employees.firstName), desc(employeeLoans.createdAt));
	const ids = rows.map((r) => r.loan.id);
	const [deducted, outside] = await Promise.all([deductedByLoan(ids), paidOutsideByLoan(ids)]);
	return rows.map((r) => {
		const d = deducted.get(r.loan.id) ?? 0;
		const o = outside.get(r.loan.id) ?? 0;
		return {
			...r.loan,
			employeeName: `${r.last}, ${r.first}`,
			employeeNo: r.no,
			employeeStatus: r.status,
			separatedOn: r.separatedOn,
			deductedCentavos: d,
			paidOutsideCentavos: o,
			balanceCentavos: Math.max(0, r.loan.principalCentavos - r.loan.alreadyPaidCentavos - d - o)
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
	const alreadyPaid = centavos(input.alreadyPaid ?? 0);
	if (amortization > principal) throw new LoanError('The monthly amount is more than the loan itself.');
	if (alreadyPaid >= principal) throw new LoanError('Already paid is the whole loan — there is nothing left to deduct.');
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
			alreadyPaidCentavos: alreadyPaid,
			startPeriod: input.startPeriod,
			releasedOn: input.releasedOn ?? null,
			termMonths: input.termMonths ?? null,
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
	const principal = input.principal === undefined ? loan.principalCentavos : centavos(input.principal);
	const startPeriod = input.startPeriod ?? loan.startPeriod;
	const amortization = centavos(input.amortization);
	const alreadyPaid = centavos(input.alreadyPaid ?? 0);

	if (principal !== loan.principalCentavos || startPeriod !== loan.startPeriod) {
		// A payslip that already counted this loan was filed against the old figures; correct those by closing and re-entering.
		const counted = await db
			.select({ id: payrollLoanDeductions.id })
			.from(payrollLoanDeductions)
			.innerJoin(payrollRunLines, eq(payrollRunLines.id, payrollLoanDeductions.lineId))
			.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
			.where(and(eq(payrollLoanDeductions.loanId, loan.id), finalOnly))
			.limit(1);
		if (counted.length > 0) {
			throw new LoanError('A locked payslip already deducted this loan, so the loan amount and start month cannot change.');
		}
		const early = await db
			.select({ id: employeeLoanSkips.id })
			.from(employeeLoanSkips)
			.where(and(eq(employeeLoanSkips.loanId, loan.id), sql`${employeeLoanSkips.payMonth} < ${startPeriod}`))
			.limit(1);
		if (early.length > 0) throw new LoanError('A skipped month falls before that start month. Remove the skip first.');
	}
	if (amortization > principal) throw new LoanError('The monthly amount is more than the loan itself.');
	if (alreadyPaid >= principal) throw new LoanError('Already paid is the whole loan — close it instead.');
	const [row] = await db
		.update(employeeLoans)
		.set({
			principalCentavos: principal,
			startPeriod,
			amortizationCentavos: amortization,
			alreadyPaidCentavos: alreadyPaid,
			referenceNo: input.referenceNo || null,
			releasedOn: input.releasedOn ?? null,
			termMonths: input.termMonths ?? null,
			note: input.note || null,
			updatedAt: new Date()
		})
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
// Skipped months
// ---------------------------------------------------------------------------

export const skipSchema = z.object({
	loanId: z.string().uuid(),
	payMonth: z.string().regex(MONTH, 'Pick the month to skip.'),
	reason: z.string().trim().min(3, 'Say why this month is skipped.').max(300)
});

/** True once the person's payslip for that pay month sits in a locked or released batch. */
async function monthCounted(employeeId: string, payMonth: string): Promise<boolean> {
	const row = await db
		.select({ id: payrollRunLines.id })
		.from(payrollRunLines)
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
		.where(
			and(
				eq(payrollRunLines.employeeId, employeeId),
				finalOnly,
				sql`substr(${payrollRuns.payDate}::text, 1, 7) = ${payMonth}`
			)
		)
		.limit(1)
		.then((r) => r.at(0));
	return !!row;
}

/** Skips for one loan, oldest month first, each flagged `locked` once a final payslip already covers it. */
export async function listSkips(loanId: string) {
	const loan = await db
		.select({ employeeId: employeeLoans.employeeId })
		.from(employeeLoans)
		.where(eq(employeeLoans.id, loanId))
		.then((r) => r.at(0));
	if (!loan) return [];
	const rows = await db
		.select({
			id: employeeLoanSkips.id,
			payMonth: employeeLoanSkips.payMonth,
			reason: employeeLoanSkips.reason,
			createdAt: employeeLoanSkips.createdAt,
			by: users.name
		})
		.from(employeeLoanSkips)
		.leftJoin(users, eq(users.id, employeeLoanSkips.createdByUserId))
		.where(eq(employeeLoanSkips.loanId, loanId))
		.orderBy(asc(employeeLoanSkips.payMonth));
	return Promise.all(rows.map(async (r) => ({ ...r, locked: await monthCounted(loan.employeeId, r.payMonth) })));
}

/** Skipped months from `fromMonth` on, per loan — what the table row says is coming up. */
export async function upcomingSkips(loanIds: string[], fromMonth: string): Promise<Map<string, string[]>> {
	const out = new Map<string, string[]>();
	if (loanIds.length === 0) return out;
	const rows = await db
		.select({ loanId: employeeLoanSkips.loanId, payMonth: employeeLoanSkips.payMonth })
		.from(employeeLoanSkips)
		.where(and(inArray(employeeLoanSkips.loanId, loanIds), sql`${employeeLoanSkips.payMonth} >= ${fromMonth}`))
		.orderBy(asc(employeeLoanSkips.payMonth));
	for (const r of rows) out.set(r.loanId, [...(out.get(r.loanId) ?? []), r.payMonth]);
	return out;
}

export async function addSkip(organizationId: string, input: z.infer<typeof skipSchema>, userId: string | null) {
	const loan = await getLoan(organizationId, input.loanId);
	if (loan.status === 'paid_off' || loan.status === 'cancelled') throw new LoanError('This loan is closed.');
	if (input.payMonth < loan.startPeriod) throw new LoanError(`This loan is not deducted before ${loan.startPeriod}.`);
	if (await monthCounted(loan.employeeId, input.payMonth)) {
		throw new LoanError('That month is already in a locked payslip. Unlock it first if it must be skipped.');
	}
	const [row] = await db
		.insert(employeeLoanSkips)
		.values({ loanId: loan.id, payMonth: input.payMonth, reason: input.reason, createdByUserId: userId })
		.onConflictDoNothing()
		.returning();
	if (!row) throw new LoanError('That month is already skipped.');
	return { loan, skip: row };
}

export async function removeSkip(organizationId: string, skipId: string) {
	const skip = await db.select().from(employeeLoanSkips).where(eq(employeeLoanSkips.id, skipId)).then((r) => r.at(0));
	if (!skip) throw new LoanError('That skip does not exist.');
	const loan = await getLoan(organizationId, skip.loanId);
	if (await monthCounted(loan.employeeId, skip.payMonth)) {
		throw new LoanError('That month is already in a locked payslip, so the skip cannot be removed.');
	}
	await db.delete(employeeLoanSkips).where(eq(employeeLoanSkips.id, skip.id));
	return { loan, skip };
}

/** Loans on an agency's schedule that were skipped for a pay month — nothing was deducted or remitted for them. */
export async function skippedLoansFor(organizationId: string, agency: LoanAgency, period: string) {
	const keys = (await listLoanTypes(organizationId)).filter((t) => agencyOfRemit(t.remitTo) === agency).map((t) => t.key);
	if (keys.length === 0) return [];
	const rows = await db
		.select({
			last: employees.lastName,
			first: employees.firstName,
			no: employees.employeeNo,
			reference: employeeLoans.referenceNo,
			reason: employeeLoanSkips.reason
		})
		.from(employeeLoanSkips)
		.innerJoin(employeeLoans, eq(employeeLoans.id, employeeLoanSkips.loanId))
		.innerJoin(employees, eq(employees.id, employeeLoans.employeeId))
		.where(
			and(
				eq(employeeLoans.organizationId, organizationId),
				eq(employeeLoanSkips.payMonth, period),
				inArray(employeeLoans.kind, keys)
			)
		)
		.orderBy(asc(employees.lastName), asc(employees.firstName));
	return rows.map((r) => ({
		name: `${r.last}, ${r.first}`,
		employeeNo: r.no,
		reference: r.reference,
		reason: r.reason
	}));
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
	const outsidePaid = await paidOutsideByLoan(ids);
	const skipped = new Set(
		(
			await db
				.select({ loanId: employeeLoanSkips.loanId })
				.from(employeeLoanSkips)
				.where(and(inArray(employeeLoanSkips.loanId, ids), eq(employeeLoanSkips.payMonth, payMonth)))
		).map((r) => r.loanId)
	);
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
		if (skipped.has(l.id)) continue;
		const remaining = l.principalCentavos - l.alreadyPaidCentavos - (outsidePaid.get(l.id) ?? 0) - (paidBefore.get(l.id) ?? 0);
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
	const outside = await paidOutsideByLoan(loans.map((l) => l.id));
	const settled = loans.filter((l) => (deducted.get(l.id) ?? 0) + (outside.get(l.id) ?? 0) + l.alreadyPaidCentavos >= l.principalCentavos).map((l) => l.id);
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
		.where(and(inArray(employeeLoans.id, ids), eq(employeeLoans.status, 'paid_off'), inArray(employeeLoans.statusNote, SETTLED_NOTES)));
	const deducted = await deductedByLoan(loans.map((l) => l.id));
	const outside = await paidOutsideByLoan(loans.map((l) => l.id));
	const owing = loans.filter((l) => (deducted.get(l.id) ?? 0) + (outside.get(l.id) ?? 0) + l.alreadyPaidCentavos < l.principalCentavos).map((l) => l.id);
	if (owing.length) {
		await db.update(employeeLoans).set({ status: 'active', statusNote: null, updatedAt: new Date() }).where(inArray(employeeLoans.id, owing));
	}
}

// ---------------------------------------------------------------------------
// Schedule: is a loan on track, and when does it end?
// ---------------------------------------------------------------------------

/** `YYYY-MM` plus `n` months (n may be negative). */
export function monthsAfter(ym: string, n: number): string {
	const [y, m] = ym.split('-').map(Number);
	const i = y! * 12 + (m! - 1) + n;
	return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/**
 * What the agreed monthly amount says should have been paid by the start of `thisMonth` against what
 * was, and the month the loan ends if the monthly amount keeps being taken. Skipped months are not due
 * and push the end out; a month still in progress is not yet behind.
 */
export function scheduleStatus(i: {
	principal: number;
	alreadyPaid: number;
	amortization: number;
	startPeriod: string;
	thisMonth: string;
	skips: ReadonlySet<string>;
	/** Taken by payroll plus received outside payroll — not what was paid before this system. */
	paidSince: number;
}): { behind: number; expectedEnd: string | null } {
	const owed = Math.max(0, i.principal - i.alreadyPaid);
	let monthsDue = 0;
	for (let m = i.startPeriod, guard = 0; m < i.thisMonth && guard < 1200; m = monthsAfter(m, 1), guard++) {
		if (!i.skips.has(m)) monthsDue++;
	}
	const behind = Math.max(0, Math.min(owed, monthsDue * i.amortization) - i.paidSince);
	const remaining = Math.max(0, owed - i.paidSince);
	if (remaining === 0 || i.amortization <= 0) return { behind, expectedEnd: null };

	let left = Math.ceil(remaining / i.amortization);
	let m = i.startPeriod > i.thisMonth ? i.startPeriod : i.thisMonth;
	for (let guard = 0; guard < 1200; guard++, m = monthsAfter(m, 1)) {
		if (i.skips.has(m)) continue;
		if (--left === 0) return { behind, expectedEnd: m };
	}
	return { behind, expectedEnd: null };
}

/** Every skipped month per loan (past and future), for the schedule maths. */
export async function skipMonthsByLoan(loanIds: string[]): Promise<Map<string, Set<string>>> {
	const out = new Map<string, Set<string>>();
	if (loanIds.length === 0) return out;
	const rows = await db
		.select({ loanId: employeeLoanSkips.loanId, payMonth: employeeLoanSkips.payMonth })
		.from(employeeLoanSkips)
		.where(inArray(employeeLoanSkips.loanId, loanIds));
	for (const r of rows) (out.get(r.loanId) ?? out.set(r.loanId, new Set()).get(r.loanId)!).add(r.payMonth);
	return out;
}

// ---------------------------------------------------------------------------
// Payments received outside payroll
// ---------------------------------------------------------------------------

/** Notes that mark a loan as closed by the system (so the system may reopen it), not by a person. */
const SETTLED_NOTES = ['Fully deducted through payroll.', 'Fully paid.'];

export const paymentSchema = z.object({
	loanId: z.string().uuid(),
	paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date it was paid.'),
	amount: pesos,
	note: z.string().trim().max(300).optional()
});

export const voidPaymentSchema = z.object({
	paymentId: z.string().uuid(),
	reason: z.string().trim().min(3, 'Say why this payment is voided.').max(300)
});

async function balanceOf(loan: EmployeeLoan): Promise<number> {
	const [d, o] = await Promise.all([deductedByLoan([loan.id]), paidOutsideByLoan([loan.id])]);
	return Math.max(0, loan.principalCentavos - loan.alreadyPaidCentavos - (d.get(loan.id) ?? 0) - (o.get(loan.id) ?? 0));
}

export async function listPayments(loanId: string) {
	return db
		.select({
			id: employeeLoanPayments.id,
			paidOn: employeeLoanPayments.paidOn,
			amountCentavos: employeeLoanPayments.amountCentavos,
			note: employeeLoanPayments.note,
			voidedAt: employeeLoanPayments.voidedAt,
			voidReason: employeeLoanPayments.voidReason,
			createdAt: employeeLoanPayments.createdAt,
			by: users.name
		})
		.from(employeeLoanPayments)
		.leftJoin(users, eq(users.id, employeeLoanPayments.createdByUserId))
		.where(eq(employeeLoanPayments.loanId, loanId))
		.orderBy(desc(employeeLoanPayments.paidOn), desc(employeeLoanPayments.createdAt));
}

export async function addPayment(
	organizationId: string,
	input: z.infer<typeof paymentSchema>,
	userId: string | null,
	opts: { separationId?: string } = {}
) {
	const loan = await getLoan(organizationId, input.loanId);
	if (loan.status === 'paid_off' || loan.status === 'cancelled') throw new LoanError('This loan is closed.');
	const amount = centavos(input.amount);
	if (input.paidOn > businessDateFor('Asia/Manila')) throw new LoanError('A payment cannot be dated in the future.');
	if (amount > (await balanceOf(loan))) throw new LoanError('That is more than the balance still owed.');
	const [payment] = await db
		.insert(employeeLoanPayments)
		.values({
			loanId: loan.id,
			paidOn: input.paidOn,
			amountCentavos: amount,
			note: input.note || null,
			createdByUserId: userId,
			separationId: opts.separationId ?? null
		})
		.returning();
	if ((await balanceOf(loan)) === 0) {
		await db
			.update(employeeLoans)
			.set({ status: 'paid_off', statusNote: 'Fully paid.', updatedAt: new Date() })
			.where(eq(employeeLoans.id, loan.id));
	}
	return { loan, payment: payment! };
}

export async function voidPayment(organizationId: string, input: z.infer<typeof voidPaymentSchema>, userId: string | null) {
	const payment = await db.select().from(employeeLoanPayments).where(eq(employeeLoanPayments.id, input.paymentId)).then((r) => r.at(0));
	if (!payment) throw new LoanError('That payment does not exist.');
	const loan = await getLoan(organizationId, payment.loanId);
	if (payment.voidedAt) throw new LoanError('That payment is already voided.');
	await db
		.update(employeeLoanPayments)
		.set({ voidedAt: new Date(), voidedByUserId: userId, voidReason: input.reason })
		.where(eq(employeeLoanPayments.id, payment.id));
	if (loan.status === 'paid_off' && loan.statusNote && SETTLED_NOTES.includes(loan.statusNote) && (await balanceOf(loan)) > 0) {
		await db
			.update(employeeLoans)
			.set({ status: 'active', statusNote: null, updatedAt: new Date() })
			.where(eq(employeeLoans.id, loan.id));
	}
	return { loan, payment };
}

// ---------------------------------------------------------------------------
// Documents (agreement, agency approval voucher)
// ---------------------------------------------------------------------------

export async function listDocuments(loanId: string) {
	return db
		.select({
			id: employeeLoanDocuments.id,
			originalName: employeeLoanDocuments.originalName,
			contentType: employeeLoanDocuments.contentType,
			sizeBytes: employeeLoanDocuments.sizeBytes,
			createdAt: employeeLoanDocuments.createdAt,
			by: users.name
		})
		.from(employeeLoanDocuments)
		.leftJoin(users, eq(users.id, employeeLoanDocuments.uploadedByUserId))
		.where(eq(employeeLoanDocuments.loanId, loanId))
		.orderBy(desc(employeeLoanDocuments.createdAt));
}

export async function addDocument(organizationId: string, loanId: string, file: File, userId: string | null) {
	const loan = await getLoan(organizationId, loanId);
	const saved = await saveLoanDocument(file);
	const [row] = await db
		.insert(employeeLoanDocuments)
		.values({
			loanId: loan.id,
			storedName: saved.storedName,
			originalName: file.name.slice(0, 200) || 'document',
			contentType: saved.contentType,
			sizeBytes: saved.sizeBytes,
			uploadedByUserId: userId
		})
		.returning();
	return { loan, document: row! };
}

/** The stored document row, only if it belongs to a loan of this organization. */
export async function getDocument(organizationId: string, documentId: string) {
	const row = await db
		.select({ doc: employeeLoanDocuments, orgId: employeeLoans.organizationId })
		.from(employeeLoanDocuments)
		.innerJoin(employeeLoans, eq(employeeLoans.id, employeeLoanDocuments.loanId))
		.where(eq(employeeLoanDocuments.id, documentId))
		.then((r) => r.at(0));
	if (!row || row.orgId !== organizationId) throw new LoanError('That document does not exist.');
	return row.doc;
}

export async function removeDocument(organizationId: string, documentId: string) {
	const doc = await getDocument(organizationId, documentId);
	await db.delete(employeeLoanDocuments).where(eq(employeeLoanDocuments.id, doc.id));
	await deleteLoanDocument(doc.storedName);
	return doc;
}
