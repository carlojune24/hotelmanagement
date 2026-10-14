import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	employeeAssignments,
	employeeLoanPayments,
	employeeLoans,
	employees,
	establishments,
	organizations,
	separationClearance,
	separationItems,
	separations,
	users
} from '$lib/server/db/schema/index';
import { businessDateFor } from '$lib/server/time';
import { LoanError, addPayment, listLoanTypes, listLoans } from './loans';
import { paidAlready } from './bonuses';
import { setThirteenthMonthCovered, thirteenthMonthFor } from './thirteenth-month';

export class SeparationError extends Error {}

const TZ = 'Asia/Manila';
const centavos = (p: number) => Math.round(p * 100);

export const KINDS = ['resigned', 'terminated', 'end_of_contract', 'retired'] as const;
export type SeparationKind = (typeof KINDS)[number];
export const KIND_LABEL: Record<SeparationKind, string> = {
	resigned: 'Resigned',
	terminated: 'Terminated',
	end_of_contract: 'End of contract',
	retired: 'Retired'
};

export const ITEM_KINDS = ['credit', 'charge', 'receipt', 'writeoff'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const ITEM_KIND_LABEL: Record<ItemKind, string> = {
	credit: 'Owed to the employee',
	charge: 'Charged to the employee',
	receipt: 'Cash received from the employee',
	writeoff: 'Written off'
};

export const DEFAULT_CLEARANCE = [
	'Company ID and access returned',
	'Uniform and equipment returned',
	'Keys and locker cleared',
	'No pending cash accountability',
	'Exit interview done'
];

export const MAX_CLEARANCE_ITEMS = 30;

/** The checklist a new separation starts with: the company's own list, else the built-in defaults. */
export async function getClearanceTemplate(organizationId: string): Promise<string[]> {
	const row = await db
		.select({ config: organizations.config })
		.from(organizations)
		.where(eq(organizations.id, organizationId))
		.then((r) => r.at(0));
	const saved = (row?.config as { clearanceItems?: unknown } | null)?.clearanceItems;
	return Array.isArray(saved) && saved.every((x) => typeof x === 'string') ? (saved as string[]) : DEFAULT_CLEARANCE;
}

/** Saves the company's checklist. Applies to separations started after this; existing ones keep theirs. */
export async function saveClearanceTemplate(organizationId: string, items: string[]) {
	const clean = [...new Set(items.map((s) => s.trim()).filter(Boolean))];
	if (clean.length > MAX_CLEARANCE_ITEMS) throw new SeparationError(`At most ${MAX_CLEARANCE_ITEMS} items.`);
	if (clean.some((s) => s.length > 120)) throw new SeparationError('Each item is at most 120 characters.');
	const org = await db
		.select({ config: organizations.config })
		.from(organizations)
		.where(eq(organizations.id, organizationId))
		.then((r) => r.at(0));
	if (!org) throw new SeparationError('Organization not found.');
	await db
		.update(organizations)
		.set({ config: { ...(org.config as object), clearanceItems: clean }, updatedAt: new Date() })
		.where(eq(organizations.id, organizationId));
	return clean;
}

// ---------------------------------------------------------------------------
// The money, as a pure function
// ---------------------------------------------------------------------------

export interface Totals {
	credits: number;
	charges: number;
	receipts: number;
	writeoffs: number;
	/** Taken from final pay against loans. */
	loanApplied: number;
	/** Still owed to the employee after charges and loan settlements — also the most that can still be applied to loans. */
	payToEmployee: number;
	/** Charges final pay could not cover, less what was received or written off. */
	nonLoanOwed: number;
	/** Balances of the employee's open loans. */
	loanOwed: number;
	stillOwed: number;
}

/**
 * Final pay covers the charges first, then whatever the admin applies to loans; what is left goes to
 * the employee. Charges the pay cannot cover are owed by the employee until received or written off.
 */
export function computeTotals(i: {
	credits: number;
	charges: number;
	receipts: number;
	writeoffs: number;
	loanApplied: number;
	loanOwed: number;
}): Totals {
	const fundsLeft = Math.max(0, i.credits - i.loanApplied);
	const covered = Math.min(i.charges, fundsLeft);
	const nonLoanOwed = Math.max(0, i.charges - covered - i.receipts - i.writeoffs);
	const payToEmployee = Math.max(0, fundsLeft - i.charges);
	return {
		credits: i.credits,
		charges: i.charges,
		receipts: i.receipts,
		writeoffs: i.writeoffs,
		loanApplied: i.loanApplied,
		payToEmployee,
		nonLoanOwed,
		loanOwed: i.loanOwed,
		stillOwed: nonLoanOwed + i.loanOwed
	};
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.');

export const startSchema = z.object({
	employeeId: z.string().uuid('Pick the employee.'),
	kind: z.enum(KINDS, { message: 'Pick why they are leaving.' }),
	lastDay: date,
	note: z.string().trim().max(500).optional()
});

export const itemSchema = z.object({
	separationId: z.string().uuid(),
	kind: z.enum(ITEM_KINDS),
	label: z.string().trim().min(2, 'Say what this is for.').max(120),
	amount: z.coerce.number().positive('Enter an amount above zero.').max(100_000_000),
	note: z.string().trim().max(300).optional()
});

export const applyLoanSchema = z.object({
	separationId: z.string().uuid(),
	loanId: z.string().uuid(),
	amount: z.coerce.number().positive('Enter an amount above zero.').max(100_000_000)
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function getRow(organizationId: string, id: string) {
	const row = await db
		.select()
		.from(separations)
		.where(and(eq(separations.id, id), eq(separations.organizationId, organizationId)))
		.then((r) => r.at(0));
	if (!row) throw new SeparationError('That separation does not exist.');
	return row;
}

/** Marks people whose last day has passed as separated. Called when the screens load. */
export async function syncSeparatedStatus(organizationId: string) {
	const today = businessDateFor(TZ);
	const due = await db
		.select({ employeeId: separations.employeeId, lastDay: separations.lastDay })
		.from(separations)
		.where(and(eq(separations.organizationId, organizationId), sql`${separations.lastDay} <= ${today}`));
	for (const d of due) {
		await db
			.update(employees)
			.set({ status: 'separated', separatedOn: d.lastDay, updatedAt: new Date() })
			.where(and(eq(employees.id, d.employeeId), sql`${employees.status} <> 'separated'`));
	}
}

interface Gathered {
	items: Array<typeof separationItems.$inferSelect>;
	applied: Array<{
		id: string;
		loanId: string;
		paidOn: string;
		amountCentavos: number;
		voidedAt: Date | null;
		kind: string;
		referenceNo: string | null;
	}>;
	loans: Awaited<ReturnType<typeof listLoans>>;
}

async function gather(organizationId: string, sepIds: string[], employeeIds: string[]) {
	const [items, applied, loans] = await Promise.all([
		sepIds.length
			? db.select().from(separationItems).where(inArray(separationItems.separationId, sepIds)).orderBy(asc(separationItems.createdAt))
			: [],
		sepIds.length
			? db
					.select({
						id: employeeLoanPayments.id,
						separationId: employeeLoanPayments.separationId,
						loanId: employeeLoanPayments.loanId,
						paidOn: employeeLoanPayments.paidOn,
						amountCentavos: employeeLoanPayments.amountCentavos,
						voidedAt: employeeLoanPayments.voidedAt,
						kind: employeeLoans.kind,
						referenceNo: employeeLoans.referenceNo
					})
					.from(employeeLoanPayments)
					.innerJoin(employeeLoans, eq(employeeLoans.id, employeeLoanPayments.loanId))
					.where(inArray(employeeLoanPayments.separationId, sepIds))
					.orderBy(asc(employeeLoanPayments.createdAt))
			: [],
		listLoans(organizationId)
	]);
	return { items, applied, loans: loans.filter((l) => employeeIds.includes(l.employeeId)) };
}

const isOpenLoan = (l: { status: string }) => l.status === 'active' || l.status === 'paused';

function totalsFor(
	sepId: string,
	employeeId: string,
	g: { items: Array<typeof separationItems.$inferSelect>; applied: Array<{ separationId: string | null; amountCentavos: number; voidedAt: Date | null }>; loans: Awaited<ReturnType<typeof listLoans>> }
): Totals {
	const live = g.items.filter((x) => x.separationId === sepId && !x.voidedAt);
	const sum = (k: ItemKind) => live.filter((x) => x.kind === k).reduce((t, x) => t + x.amountCentavos, 0);
	return computeTotals({
		credits: sum('credit'),
		charges: sum('charge'),
		receipts: sum('receipt'),
		writeoffs: sum('writeoff'),
		loanApplied: g.applied.filter((a) => a.separationId === sepId && !a.voidedAt).reduce((t, a) => t + a.amountCentavos, 0),
		loanOwed: g.loans.filter((l) => l.employeeId === employeeId && isOpenLoan(l)).reduce((t, l) => t + l.balanceCentavos, 0)
	});
}

export interface SeparationListRow {
	id: string;
	employeeId: string;
	employeeName: string;
	employeeNo: string;
	establishment: string | null;
	kind: SeparationKind;
	lastDay: string;
	status: 'in_process' | 'cleared';
	stillOwed: number;
	payToEmployee: number;
	finalPayPaidOn: string | null;
	stepsDone: number;
	stepsTotal: number;
}

export async function listSeparations(organizationId: string): Promise<SeparationListRow[]> {
	await syncSeparatedStatus(organizationId);
	const rows = await db
		.select({ s: separations, last: employees.lastName, first: employees.firstName, no: employees.employeeNo })
		.from(separations)
		.innerJoin(employees, eq(employees.id, separations.employeeId))
		.where(eq(separations.organizationId, organizationId))
		.orderBy(desc(separations.lastDay));
	if (rows.length === 0) return [];
	const sepIds = rows.map((r) => r.s.id);
	const g = await gather(organizationId, sepIds, rows.map((r) => r.s.employeeId));
	const clearance = await db.select().from(separationClearance).where(inArray(separationClearance.separationId, sepIds));
	const home = await db
		.select({ employeeId: employeeAssignments.employeeId, name: establishments.name })
		.from(employeeAssignments)
		.innerJoin(establishments, eq(establishments.id, employeeAssignments.establishmentId))
		.where(and(inArray(employeeAssignments.employeeId, rows.map((r) => r.s.employeeId)), eq(employeeAssignments.isPrimary, true)));
	const homeOf = new Map(home.map((h) => [h.employeeId, h.name]));

	return rows.map((r) => {
		const t = totalsFor(r.s.id, r.s.employeeId, g);
		const list = clearance.filter((c) => c.separationId === r.s.id);
		const steps = [t.payToEmployee === 0 || !!r.s.finalPayPaidOn, t.stillOwed === 0, list.length > 0 && list.every((c) => c.doneAt)];
		return {
			id: r.s.id,
			employeeId: r.s.employeeId,
			employeeName: `${r.last}, ${r.first}`,
			employeeNo: r.no,
			establishment: homeOf.get(r.s.employeeId) ?? null,
			kind: r.s.kind as SeparationKind,
			lastDay: r.s.lastDay,
			status: r.s.status as 'in_process' | 'cleared',
			stillOwed: t.stillOwed,
			payToEmployee: t.payToEmployee,
			finalPayPaidOn: r.s.finalPayPaidOn,
			stepsDone: steps.filter(Boolean).length,
			stepsTotal: steps.length
		};
	});
}

export async function getSeparation(organizationId: string, id: string) {
	await syncSeparatedStatus(organizationId);
	const sep = await getRow(organizationId, id);
	const [emp, g, clearance, types] = await Promise.all([
		db.select().from(employees).where(eq(employees.id, sep.employeeId)).then((r) => r.at(0)!),
		gather(organizationId, [sep.id], [sep.employeeId]),
		db.select().from(separationClearance).where(eq(separationClearance.separationId, sep.id)).orderBy(asc(separationClearance.sortOrder)),
		listLoanTypes(organizationId)
	]);
	const assignments = await db
		.select({ position: employeeAssignments.position, est: establishments.name, isPrimary: employeeAssignments.isPrimary, start: employeeAssignments.startDate })
		.from(employeeAssignments)
		.innerJoin(establishments, eq(establishments.id, employeeAssignments.establishmentId))
		.where(eq(employeeAssignments.employeeId, sep.employeeId))
		.orderBy(desc(employeeAssignments.isPrimary), desc(employeeAssignments.startDate));
	const nameOf = new Map(types.map((t) => [t.key, t.name]));
	const userIds = [sep.startedByUserId, sep.finalPayPaidByUserId, sep.clearedByUserId].filter((x): x is string => !!x);
	const people = userIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [];
	const byName = new Map(people.map((u) => [u.id, u.name]));

	const totals = totalsFor(sep.id, sep.employeeId, g);
	const year = Number(sep.lastDay.slice(0, 4));
	const thirteenth = await thirteenthMonthFor(sep.employeeId, year, sep.lastDay);
	// A mid-year installment already issued comes off the final-pay figure.
	const midYearPaid = (await paidAlready([sep.employeeId], year)).mid.get(sep.employeeId) ?? 0;
	const thirteenthLine = g.items.find((i) => i.source === 'thirteenth_month' && !i.voidedAt) ?? null;
	const loans = g.loans
		.filter(isOpenLoan)
		.map((l) => ({
			id: l.id,
			label: nameOf.get(l.kind) ?? l.kind,
			referenceNo: l.referenceNo,
			status: l.status,
			balance: l.balanceCentavos,
			monthly: l.amortizationCentavos
		}))
		.filter((l) => l.balance > 0);
	const loanLabel = new Map(g.loans.map((l) => [l.id, nameOf.get(l.kind) ?? l.kind]));
	const items = g.items;
	const steps = {
		finalPay: totals.payToEmployee === 0 || !!sep.finalPayPaidOn,
		nothingOwed: totals.stillOwed === 0,
		checklist: clearance.length > 0 && clearance.every((c) => c.doneAt)
	};
	return {
		sep: { ...sep, kind: sep.kind as SeparationKind, status: sep.status as 'in_process' | 'cleared' },
		employee: {
			id: emp.id,
			name: `${emp.lastName}, ${emp.firstName}`,
			no: emp.employeeNo,
			status: emp.status,
			position: assignments[0]?.position ?? null,
			establishment: assignments[0]?.est ?? null
		},
		startedBy: sep.startedByUserId ? (byName.get(sep.startedByUserId) ?? null) : null,
		finalPayPaidBy: sep.finalPayPaidByUserId ? (byName.get(sep.finalPayPaidByUserId) ?? null) : null,
		clearedBy: sep.clearedByUserId ? (byName.get(sep.clearedByUserId) ?? null) : null,
		items: items.map((x) => ({
			id: x.id,
			kind: x.kind as ItemKind,
			label: x.label,
			amountCentavos: x.amountCentavos,
			note: x.note,
			source: x.source,
			createdAt: x.createdAt,
			voidedAt: x.voidedAt,
			voidReason: x.voidReason
		})),
		applied: g.applied.map((a) => ({
			id: a.id,
			loanLabel: loanLabel.get(a.loanId) ?? 'Loan',
			referenceNo: a.referenceNo,
			paidOn: a.paidOn,
			amountCentavos: a.amountCentavos,
			voidedAt: a.voidedAt
		})),
		loans,
		clearance: clearance.map((c) => ({ id: c.id, label: c.label, doneAt: c.doneAt })),
		totals,
		thirteenth: {
			...thirteenth,
			covered: emp.thirteenthMonthCovered,
			midYearPaid,
			due: Math.max(0, thirteenth.amount - midYearPaid),
			addedAmount: thirteenthLine?.amountCentavos ?? null
		},
		steps,
		canClear: sep.status === 'in_process' && steps.finalPay && steps.nothingOwed && steps.checklist
	};
}

/** People who can start a separation: not removed, no separation yet, and not already marked separated. */
export async function separableEmployees(organizationId: string) {
	const taken = await db.select({ id: separations.employeeId }).from(separations).where(eq(separations.organizationId, organizationId));
	const takenIds = new Set(taken.map((t) => t.id));
	const rows = await db
		.select({ id: employees.id, last: employees.lastName, first: employees.firstName, no: employees.employeeNo, status: employees.status })
		.from(employees)
		.where(and(eq(employees.organizationId, organizationId), isNull(employees.deletedAt)))
		.orderBy(asc(employees.lastName), asc(employees.firstName));
	return rows
		.filter((r) => !takenIds.has(r.id))
		.map((r) => ({ id: r.id, name: `${r.last}, ${r.first}`, employeeNo: r.no, alreadySeparated: r.status === 'separated' }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function startSeparation(organizationId: string, input: z.infer<typeof startSchema>, userId: string | null) {
	const emp = await db
		.select()
		.from(employees)
		.where(and(eq(employees.id, input.employeeId), eq(employees.organizationId, organizationId), isNull(employees.deletedAt)))
		.then((r) => r.at(0));
	if (!emp) throw new SeparationError('That person does not exist.');
	const existing = await db.select({ id: separations.id }).from(separations).where(eq(separations.employeeId, emp.id)).then((r) => r.at(0));
	if (existing) throw new SeparationError('This person already has a separation on file.');

	const template = await getClearanceTemplate(organizationId);
	const sep = await db.transaction(async (tx) => {
		const [row] = await tx
			.insert(separations)
			.values({
				organizationId,
				employeeId: emp.id,
				kind: input.kind,
				lastDay: input.lastDay,
				note: input.note || null,
				startedByUserId: userId
			})
			.returning();
		if (template.length > 0) {
			await tx
				.insert(separationClearance)
				.values(template.map((label, i) => ({ separationId: row!.id, label, sortOrder: i })));
		}
		// Their assignments end on the last day (inclusive), so scheduling and DTR stop there.
		await tx
			.update(employeeAssignments)
			.set({ endDate: input.lastDay, updatedAt: new Date() })
			.where(
				and(
					eq(employeeAssignments.employeeId, emp.id),
					sql`(${employeeAssignments.endDate} is null or ${employeeAssignments.endDate} > ${input.lastDay})`
				)
			);
		return row!;
	});
	await syncSeparatedStatus(organizationId);
	return sep;
}

export async function setLastDay(organizationId: string, id: string, lastDay: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) throw new SeparationError('Pick a date.');
	const sep = await getRow(organizationId, id);
	if (sep.status === 'cleared') throw new SeparationError('This separation is already cleared.');
	await db.transaction(async (tx) => {
		await tx
			.update(employeeAssignments)
			.set({ endDate: lastDay, updatedAt: new Date() })
			.where(
				and(
					eq(employeeAssignments.employeeId, sep.employeeId),
					sql`(${employeeAssignments.endDate} is null or ${employeeAssignments.endDate} = ${sep.lastDay} or ${employeeAssignments.endDate} > ${lastDay})`
				)
			);
		await tx.update(separations).set({ lastDay, updatedAt: new Date() }).where(eq(separations.id, id));
		await tx
			.update(employees)
			.set({ separatedOn: lastDay, updatedAt: new Date() })
			.where(and(eq(employees.id, sep.employeeId), eq(employees.status, 'separated')));
	});
	await syncSeparatedStatus(organizationId);
}

async function totalsOf(organizationId: string, sep: typeof separations.$inferSelect) {
	const g = await gather(organizationId, [sep.id], [sep.employeeId]);
	return totalsFor(sep.id, sep.employeeId, g);
}

export async function addItem(organizationId: string, input: z.infer<typeof itemSchema>) {
	const sep = await getRow(organizationId, input.separationId);
	if (sep.status === 'cleared') throw new SeparationError('This separation is already cleared.');
	const amount = centavos(input.amount);
	if (input.kind === 'receipt' || input.kind === 'writeoff') {
		const t = await totalsOf(organizationId, sep);
		if (amount > t.nonLoanOwed) {
			throw new SeparationError(
				t.nonLoanOwed === 0
					? 'Nothing is owed besides loans. Record loan payments on the loan itself.'
					: 'That is more than the amount still owed.'
			);
		}
	}
	const [row] = await db
		.insert(separationItems)
		.values({ separationId: sep.id, kind: input.kind, label: input.label, amountCentavos: amount, note: input.note || null })
		.returning();
	return { sep, item: row! };
}

export async function voidItem(organizationId: string, itemId: string, reason: string) {
	if (reason.trim().length < 3) throw new SeparationError('Say why this line is voided.');
	const item = await db.select().from(separationItems).where(eq(separationItems.id, itemId)).then((r) => r.at(0));
	if (!item) throw new SeparationError('That line does not exist.');
	const sep = await getRow(organizationId, item.separationId);
	if (sep.status === 'cleared') throw new SeparationError('This separation is already cleared.');
	if (item.voidedAt) throw new SeparationError('That line is already voided.');
	if (item.kind === 'credit') {
		const t = await totalsOf(organizationId, sep);
		if (t.credits - item.amountCentavos < t.loanApplied) {
			throw new SeparationError('Loan settlements were taken from this pay. Undo them first.');
		}
	}
	await db
		.update(separationItems)
		.set({ voidedAt: new Date(), voidReason: reason.trim() })
		.where(eq(separationItems.id, item.id));
	return { sep, item };
}

/** Takes `amount` of the final pay against one of the person's loans, recorded as a payment received. */
export async function applyToLoan(organizationId: string, input: z.infer<typeof applyLoanSchema>, userId: string | null) {
	const sep = await getRow(organizationId, input.separationId);
	if (sep.status === 'cleared') throw new SeparationError('This separation is already cleared.');
	const loan = await db.select().from(employeeLoans).where(eq(employeeLoans.id, input.loanId)).then((r) => r.at(0));
	if (!loan || loan.employeeId !== sep.employeeId || loan.organizationId !== organizationId) {
		throw new SeparationError('That loan does not belong to this person.');
	}
	const t = await totalsOf(organizationId, sep);
	if (centavos(input.amount) > t.payToEmployee) {
		throw new SeparationError(
			t.payToEmployee === 0 ? 'There is no final pay left to apply.' : 'That is more than the final pay left to apply.'
		);
	}
	try {
		return await addPayment(
			organizationId,
			{ loanId: loan.id, paidOn: businessDateFor(TZ), amount: input.amount, note: 'Settled from final pay' },
			userId,
			{ separationId: sep.id }
		);
	} catch (e) {
		if (e instanceof LoanError) throw new SeparationError(e.message);
		throw e;
	}
}

/** Adds the pro-rated 13th month (PD 851) to the statement as a credit, computed from final payslips. */
export async function addThirteenthMonth(organizationId: string, id: string) {
	const sep = await getRow(organizationId, id);
	if (sep.status === 'cleared') throw new SeparationError('This separation is already cleared.');
	const year = Number(sep.lastDay.slice(0, 4));
	const existing = await db
		.select({ id: separationItems.id })
		.from(separationItems)
		.where(and(eq(separationItems.separationId, id), eq(separationItems.source, 'thirteenth_month'), isNull(separationItems.voidedAt)))
		.then((r) => r.at(0));
	if (existing) throw new SeparationError('The 13th month is already in this statement. Void that line to compute it again.');
	const r = await thirteenthMonthFor(sep.employeeId, year, sep.lastDay);
	if (!r.entitled) {
		throw new SeparationError(
			r.reason === 'not_covered'
				? 'This person is marked as not entitled to the 13th month.'
				: r.reason === 'under_one_month'
					? 'They served less than one month this year, so no 13th month is due.'
					: 'There is no basic pay on locked payslips for this year yet. Lock their payroll first.'
		);
	}
	const midYearPaid = (await paidAlready([sep.employeeId], year)).mid.get(sep.employeeId) ?? 0;
	const due = r.amount - midYearPaid;
	if (due <= 0) throw new SeparationError('Their 13th month was already paid in full as a mid-year installment.');
	const [row] = await db
		.insert(separationItems)
		.values({
			separationId: id,
			kind: 'credit',
			label: `13th month pay ${year} (pro-rated)`,
			amountCentavos: due,
			note:
				`Basic earned ${r.basicEarned / 100} less late/undertime ${r.lateDeductions / 100}, ÷ 12 = ${r.amount / 100}, from ${r.finalPayslips} final payslip${r.finalPayslips === 1 ? '' : 's'}` +
				(midYearPaid > 0 ? `; less ${midYearPaid / 100} already paid mid-year` : ''),
			source: 'thirteenth_month',
			sourceYear: year
		})
		.returning();
	return { sep, item: row!, result: r };
}

export async function setEntitlement(organizationId: string, id: string, covered: boolean, note: string) {
	const sep = await getRow(organizationId, id);
	if (!covered && note.trim().length < 3) throw new SeparationError('Say why they are not entitled (for example, managerial).');
	await setThirteenthMonthCovered(organizationId, sep.employeeId, covered, note.trim() || null);
	return sep;
}

export async function markFinalPayPaid(organizationId: string, id: string, userId: string | null) {
	const sep = await getRow(organizationId, id);
	if (sep.status === 'cleared') throw new SeparationError('This separation is already cleared.');
	if (sep.finalPayPaidOn) throw new SeparationError('Final pay is already marked as paid.');
	const t = await totalsOf(organizationId, sep);
	if (t.payToEmployee === 0) throw new SeparationError('There is no final pay to hand over.');
	await db
		.update(separations)
		.set({ finalPayPaidOn: businessDateFor(TZ), finalPayPaidByUserId: userId, updatedAt: new Date() })
		.where(eq(separations.id, id));
	return { sep, amount: t.payToEmployee };
}

export async function toggleClearance(organizationId: string, itemId: string, done: boolean, userId: string | null) {
	const row = await db.select().from(separationClearance).where(eq(separationClearance.id, itemId)).then((r) => r.at(0));
	if (!row) throw new SeparationError('That checklist item does not exist.');
	const sep = await getRow(organizationId, row.separationId);
	if (sep.status === 'cleared') throw new SeparationError('This separation is already cleared.');
	await db
		.update(separationClearance)
		.set(done ? { doneAt: new Date(), doneByUserId: userId } : { doneAt: null, doneByUserId: null })
		.where(eq(separationClearance.id, itemId));
	return sep;
}

export async function addClearanceItem(organizationId: string, id: string, label: string) {
	const sep = await getRow(organizationId, id);
	if (sep.status === 'cleared') throw new SeparationError('This separation is already cleared.');
	const clean = label.trim();
	if (clean.length < 3) throw new SeparationError('Say what needs to be cleared.');
	const last = await db
		.select({ n: sql<number>`coalesce(max(${separationClearance.sortOrder}), -1)::int` })
		.from(separationClearance)
		.where(eq(separationClearance.separationId, id))
		.then((r) => r[0]!.n);
	await db.insert(separationClearance).values({ separationId: id, label: clean.slice(0, 120), sortOrder: last + 1 });
	return sep;
}

export async function clearSeparation(organizationId: string, id: string, userId: string | null) {
	const view = await getSeparation(organizationId, id);
	if (view.sep.status === 'cleared') throw new SeparationError('This separation is already cleared.');
	const missing: string[] = [];
	if (!view.steps.finalPay) missing.push('hand over the final pay');
	if (!view.steps.nothingOwed) missing.push('settle or write off what is still owed');
	if (!view.steps.checklist) missing.push('finish the clearance checklist');
	if (missing.length > 0) throw new SeparationError(`Cannot clear yet: ${missing.join(', ')}.`);
	await db
		.update(separations)
		.set({ status: 'cleared', clearedAt: new Date(), clearedByUserId: userId, updatedAt: new Date() })
		.where(eq(separations.id, id));
	return view.sep;
}
