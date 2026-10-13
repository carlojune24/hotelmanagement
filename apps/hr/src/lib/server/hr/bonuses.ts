import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	bonusBatches,
	bonusLines,
	employeeAssignments,
	employees,
	establishments,
	payrollBatches,
	payrollRunLines,
	payrollRuns,
	separationItems,
	separations
} from '$lib/server/db/schema/index';
import { businessDateFor } from '$lib/server/time';
import { TAX_EXEMPT_CENTAVOS, thirteenthMonthFor } from './thirteenth-month';

export class BonusError extends Error {}

const TZ = 'Asia/Manila';
const centavos = (p: number) => Math.round(p * 100);

export const KINDS = ['thirteenth_mid_year', 'thirteenth_year_end', 'other'] as const;
export type BonusKind = (typeof KINDS)[number];
export const KIND_LABEL: Record<BonusKind, string> = {
	thirteenth_mid_year: '13th month — mid-year',
	thirteenth_year_end: '13th month — year-end',
	other: 'Other bonus'
};
export const EXCLUDED_LABEL: Record<string, string> = {
	not_covered: 'Not entitled',
	under_one_month: 'Under one month',
	nothing_earned: 'No basic pay yet',
	paid_in_final_pay: 'Paid in final pay'
};

const isThirteenth = (k: string) => k === 'thirteenth_mid_year' || k === 'thirteenth_year_end';

export const createSchema = z
	.object({
		kind: z.enum(KINDS, { message: 'Pick what to pay.' }),
		year: z.coerce.number().int().min(2000).max(2100),
		/** An establishment id, or `all`. */
		establishmentId: z.string().min(1, 'Pick the establishment.'),
		label: z.string().trim().max(80).optional(),
		throughDate: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
		defaultAmount: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().min(0).max(100_000_000).optional())
	})
	.refine((v) => v.kind !== 'other' || (v.label && v.label.length >= 2), {
		message: 'Name this bonus, for example "Christmas bonus".',
		path: ['label']
	});

// ---------------------------------------------------------------------------
// Building a batch
// ---------------------------------------------------------------------------

interface Person {
	employeeId: string;
	no: string;
	name: string;
	position: string | null;
}

/** People paid through this establishment this year — from their final payslips, the same source as the pay. */
async function peopleFromPayslips(establishmentId: string, year: number): Promise<Person[]> {
	const rows = await db
		.select({
			employeeId: payrollRunLines.employeeId,
			no: payrollRunLines.employeeNo,
			name: payrollRunLines.employeeName,
			position: payrollRunLines.position,
			cutoffEnd: payrollRuns.cutoffEnd
		})
		.from(payrollRunLines)
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
		.where(
			and(
				eq(payrollRunLines.establishmentId, establishmentId),
				inArray(payrollBatches.status, ['locked', 'released']),
				gte(payrollRuns.cutoffEnd, `${year}-01-01`),
				lte(payrollRuns.cutoffEnd, `${year}-12-31`)
			)
		)
		.orderBy(desc(payrollRuns.cutoffEnd));
	const seen = new Map<string, Person>();
	for (const r of rows) {
		if (!seen.has(r.employeeId)) seen.set(r.employeeId, { employeeId: r.employeeId, no: r.no, name: r.name, position: r.position });
	}
	return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Staff currently assigned here, for a one-off bonus. */
async function currentStaff(establishmentId: string): Promise<Person[]> {
	const today = businessDateFor(TZ);
	const rows = await db
		.select({
			employeeId: employees.id,
			no: employees.employeeNo,
			last: employees.lastName,
			first: employees.firstName,
			position: employeeAssignments.position
		})
		.from(employeeAssignments)
		.innerJoin(employees, eq(employees.id, employeeAssignments.employeeId))
		.where(
			and(
				eq(employeeAssignments.establishmentId, establishmentId),
				lte(employeeAssignments.startDate, today),
				sql`(${employeeAssignments.endDate} is null or ${employeeAssignments.endDate} >= ${today})`,
				isNull(employees.deletedAt),
				sql`${employees.status} <> 'separated'`
			)
		)
		.orderBy(asc(employees.lastName), asc(employees.firstName));
	return rows.map((r) => ({ employeeId: r.employeeId, no: r.no, name: `${r.last}, ${r.first}`, position: r.position }));
}

type Batch = typeof bonusBatches.$inferSelect;

async function paidAlready(employeeIds: string[], year: number) {
	const mid = new Map<string, number>();
	const finalPay = new Map<string, number>();
	if (employeeIds.length === 0) return { mid, finalPay };
	const midRows = await db
		.select({ employeeId: bonusLines.employeeId, total: sql<number>`coalesce(sum(${bonusLines.amountCentavos}), 0)::bigint` })
		.from(bonusLines)
		.innerJoin(bonusBatches, eq(bonusBatches.id, bonusLines.batchId))
		.where(
			and(
				inArray(bonusLines.employeeId, employeeIds),
				eq(bonusBatches.kind, 'thirteenth_mid_year'),
				eq(bonusBatches.year, year),
				eq(bonusBatches.status, 'issued')
			)
		)
		.groupBy(bonusLines.employeeId);
	for (const r of midRows) mid.set(r.employeeId, Number(r.total));
	const finalRows = await db
		.select({ employeeId: separations.employeeId, total: sql<number>`coalesce(sum(${separationItems.amountCentavos}), 0)::bigint` })
		.from(separationItems)
		.innerJoin(separations, eq(separations.id, separationItems.separationId))
		.where(
			and(
				inArray(separations.employeeId, employeeIds),
				eq(separationItems.source, 'thirteenth_month'),
				eq(separationItems.sourceYear, year),
				isNull(separationItems.voidedAt)
			)
		)
		.groupBy(separations.employeeId);
	for (const r of finalRows) finalPay.set(r.employeeId, Number(r.total));
	return { mid, finalPay };
}

async function fillLines(batch: Batch, defaultAmountCentavos = 0) {
	await db.delete(bonusLines).where(eq(bonusLines.batchId, batch.id));
	if (batch.kind === 'other') {
		const staff = await currentStaff(batch.establishmentId);
		if (staff.length) {
			await db.insert(bonusLines).values(
				staff.map((p) => ({
					batchId: batch.id,
					employeeId: p.employeeId,
					employeeNo: p.no,
					employeeName: p.name,
					position: p.position,
					amountCentavos: defaultAmountCentavos
				}))
			);
		}
		return;
	}
	const people = await peopleFromPayslips(batch.establishmentId, batch.year);
	if (people.length === 0) return;
	const through = batch.kind === 'thirteenth_mid_year' ? (batch.throughDate ?? `${batch.year}-06-30`) : `${batch.year}-12-31`;
	const paid = await paidAlready(people.map((p) => p.employeeId), batch.year);
	const status = await db
		.select({ id: employees.id, status: employees.status })
		.from(employees)
		.where(inArray(employees.id, people.map((p) => p.employeeId)));
	const separated = new Set(status.filter((s) => s.status === 'separated').map((s) => s.id));

	const values = [];
	for (const p of people) {
		const r = await thirteenthMonthFor(p.employeeId, batch.year, through);
		const accrued = r.entitled ? r.amount : 0;
		// Someone whose 13th month went out with their final pay is not paid again, mid-year or year-end.
		const final = paid.finalPay.get(p.employeeId) ?? 0;
		const already = batch.kind === 'thirteenth_year_end' ? (paid.mid.get(p.employeeId) ?? 0) + final : 0;
		let excluded: string | null = r.reason;
		if (!excluded && final > 0) excluded = 'paid_in_final_pay';
		values.push({
			batchId: batch.id,
			employeeId: p.employeeId,
			employeeNo: p.no,
			employeeName: p.name,
			position: p.position,
			basicEarnedCentavos: r.basicEarned,
			lateCentavos: r.lateDeductions,
			accruedCentavos: accrued,
			alreadyPaidCentavos: already,
			amountCentavos: excluded ? 0 : Math.max(0, accrued - already),
			excludedReason: excluded,
			note: separated.has(p.employeeId) ? 'Separated' : null
		});
	}
	await db.insert(bonusLines).values(values);
}

export async function createBatches(organizationId: string, input: z.infer<typeof createSchema>, userId: string | null) {
	let ests: Array<{ id: string; name: string }>;
	if (input.establishmentId === 'all') {
		ests = await db
			.select({ id: establishments.id, name: establishments.name })
			.from(establishments)
			.where(and(eq(establishments.organizationId, organizationId), isNull(establishments.deletedAt), eq(establishments.status, 'active')))
			.orderBy(asc(establishments.name));
	} else {
		ests = await db
			.select({ id: establishments.id, name: establishments.name })
			.from(establishments)
			.where(and(eq(establishments.id, input.establishmentId), eq(establishments.organizationId, organizationId)));
	}
	if (ests.length === 0) throw new BonusError('That establishment does not exist.');

	const label =
		input.kind === 'thirteenth_mid_year'
			? `13th month — mid-year ${input.year}`
			: input.kind === 'thirteenth_year_end'
				? `13th month — year-end ${input.year}`
				: input.label!;
	const created: string[] = [];
	const skipped: string[] = [];
	for (const est of ests) {
		const existing = await db
			.select({ id: bonusBatches.id })
			.from(bonusBatches)
			.where(
				and(
					eq(bonusBatches.establishmentId, est.id),
					eq(bonusBatches.kind, input.kind),
					eq(bonusBatches.year, input.year),
					eq(bonusBatches.label, label)
				)
			)
			.then((r) => r.at(0));
		if (existing) {
			skipped.push(est.name);
			continue;
		}
		const [row] = await db
			.insert(bonusBatches)
			.values({
				organizationId,
				establishmentId: est.id,
				kind: input.kind,
				label,
				year: input.year,
				throughDate: input.kind === 'thirteenth_mid_year' ? (input.throughDate ?? `${input.year}-06-30`) : null,
				createdByUserId: userId
			})
			.returning();
		await fillLines(row!, centavos(input.defaultAmount ?? 0));
		created.push(row!.id);
	}
	if (created.length === 0) throw new BonusError('That batch already exists for the selected establishment.');
	return { created, skipped };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getBatchRow(organizationId: string, id: string) {
	const row = await db
		.select()
		.from(bonusBatches)
		.where(and(eq(bonusBatches.id, id), eq(bonusBatches.organizationId, organizationId)))
		.then((r) => r.at(0));
	if (!row) throw new BonusError('That bonus batch does not exist.');
	return row;
}

export async function listBatches(organizationId: string, year: number) {
	const batches = await db
		.select({ b: bonusBatches, est: establishments.name, slug: establishments.slug })
		.from(bonusBatches)
		.innerJoin(establishments, eq(establishments.id, bonusBatches.establishmentId))
		.where(and(eq(bonusBatches.organizationId, organizationId), eq(bonusBatches.year, year)))
		.orderBy(asc(establishments.name), asc(bonusBatches.kind), asc(bonusBatches.label));
	const ids = batches.map((x) => x.b.id);
	const lines = ids.length
		? await db.select().from(bonusLines).where(inArray(bonusLines.batchId, ids)).orderBy(asc(bonusLines.employeeName))
		: [];

	// Benefits already given this year, for the tax-exemption watch.
	const people = [...new Set(lines.map((l) => l.employeeId))];
	const ytd = new Map<string, number>();
	if (people.length) {
		const issued = await db
			.select({ employeeId: bonusLines.employeeId, total: sql<number>`coalesce(sum(${bonusLines.amountCentavos}), 0)::bigint` })
			.from(bonusLines)
			.innerJoin(bonusBatches, eq(bonusBatches.id, bonusLines.batchId))
			.where(and(inArray(bonusLines.employeeId, people), eq(bonusBatches.year, year), eq(bonusBatches.status, 'issued')))
			.groupBy(bonusLines.employeeId);
		for (const r of issued) ytd.set(r.employeeId, Number(r.total));
		const finalPay = await paidAlready(people, year);
		for (const [id, v] of finalPay.finalPay) ytd.set(id, (ytd.get(id) ?? 0) + v);
	}

	return batches.map((x) => {
		const mine = lines.filter((l) => l.batchId === x.b.id);
		return {
			id: x.b.id,
			establishmentId: x.b.establishmentId,
			establishment: x.est,
			establishmentSlug: x.slug,
			kind: x.b.kind as BonusKind,
			label: x.b.label,
			year: x.b.year,
			throughDate: x.b.throughDate,
			status: x.b.status as 'draft' | 'issued',
			issuedOn: x.b.issuedOn,
			total: mine.reduce((t, l) => t + l.amountCentavos, 0),
			paidCount: mine.filter((l) => l.amountCentavos > 0).length,
			lines: mine.map((l) => {
				const sofar = (ytd.get(l.employeeId) ?? 0) + (x.b.status === 'issued' ? 0 : l.amountCentavos);
				return {
					id: l.id,
					employeeId: l.employeeId,
					employeeNo: l.employeeNo,
					employeeName: l.employeeName,
					position: l.position,
					basicEarned: l.basicEarnedCentavos,
					late: l.lateCentavos,
					accrued: l.accruedCentavos,
					alreadyPaid: l.alreadyPaidCentavos,
					amount: l.amountCentavos,
					excludedReason: l.excludedReason,
					note: l.note,
					overTaxExemption: sofar > TAX_EXEMPT_CENTAVOS
				};
			})
		};
	});
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function draftOrThrow(organizationId: string, id: string) {
	const b = await getBatchRow(organizationId, id);
	if (b.status === 'issued') throw new BonusError('This batch is issued. Reopen it to change it.');
	return b;
}

/** Recomputes a 13th-month draft from the payslips as they are now. */
export async function refreshBatch(organizationId: string, id: string) {
	const b = await draftOrThrow(organizationId, id);
	if (!isThirteenth(b.kind)) throw new BonusError('Other bonuses are not computed — edit the amounts instead.');
	await fillLines(b);
	return b;
}

export async function setLineAmount(organizationId: string, lineId: string, amountPesos: number) {
	if (!(amountPesos >= 0) || amountPesos > 100_000_000) throw new BonusError('Enter an amount of zero or more.');
	const line = await db.select().from(bonusLines).where(eq(bonusLines.id, lineId)).then((r) => r.at(0));
	if (!line) throw new BonusError('That line does not exist.');
	const b = await draftOrThrow(organizationId, line.batchId);
	if (b.kind !== 'other') throw new BonusError('The 13th month is computed from payslips, not typed.');
	await db
		.update(bonusLines)
		.set({ amountCentavos: centavos(amountPesos), updatedAt: new Date() })
		.where(eq(bonusLines.id, lineId));
	return b;
}

export async function issueBatch(organizationId: string, id: string, userId: string | null) {
	const b = await draftOrThrow(organizationId, id);
	const total = await db
		.select({ t: sql<number>`coalesce(sum(${bonusLines.amountCentavos}), 0)::bigint` })
		.from(bonusLines)
		.where(eq(bonusLines.batchId, id))
		.then((r) => Number(r[0]!.t));
	if (total <= 0) throw new BonusError('There is nothing to pay in this batch.');
	if (b.kind === 'thirteenth_year_end') {
		// A draft mid-year installment would not be deducted from this balance, and would be paid twice.
		const midDraft = await db
			.select({ id: bonusBatches.id })
			.from(bonusBatches)
			.where(
				and(
					eq(bonusBatches.establishmentId, b.establishmentId),
					eq(bonusBatches.kind, 'thirteenth_mid_year'),
					eq(bonusBatches.year, b.year),
					eq(bonusBatches.status, 'draft')
				)
			)
			.limit(1);
		if (midDraft.length > 0) {
			throw new BonusError('Issue or remove the mid-year installment first, so it is deducted from this balance.');
		}
	}
	const [row] = await db
		.update(bonusBatches)
		.set({ status: 'issued', issuedOn: businessDateFor(TZ), issuedByUserId: userId, updatedAt: new Date() })
		.where(eq(bonusBatches.id, id))
		.returning();
	return { batch: row!, total };
}

export async function reopenBatch(organizationId: string, id: string) {
	const b = await getBatchRow(organizationId, id);
	if (b.status !== 'issued') throw new BonusError('This batch is not issued.');
	if (b.kind === 'thirteenth_mid_year') {
		const later = await db
			.select({ id: bonusBatches.id })
			.from(bonusBatches)
			.where(
				and(
					eq(bonusBatches.establishmentId, b.establishmentId),
					eq(bonusBatches.kind, 'thirteenth_year_end'),
					eq(bonusBatches.year, b.year),
					eq(bonusBatches.status, 'issued')
				)
			)
			.limit(1);
		if (later.length > 0) throw new BonusError('The year-end balance was computed after this installment. Reopen that first.');
	}
	const [row] = await db
		.update(bonusBatches)
		.set({ status: 'draft', issuedOn: null, issuedByUserId: null, updatedAt: new Date() })
		.where(eq(bonusBatches.id, id))
		.returning();
	return row!;
}

/** Deletes a draft batch and its lines (an issued batch must be reopened first). */
export async function deleteDraft(organizationId: string, id: string) {
	const b = await draftOrThrow(organizationId, id);
	await db.delete(bonusLines).where(eq(bonusLines.batchId, id));
	await db.delete(bonusBatches).where(eq(bonusBatches.id, id));
	return b;
}

/** One batch with its lines and tax flags, for the print pages. */
export async function getBatchView(organizationId: string, id: string) {
	const row = await getBatchRow(organizationId, id);
	const view = (await listBatches(organizationId, row.year)).find((b) => b.id === id);
	if (!view) throw new BonusError('That bonus batch does not exist.');
	return view;
}
