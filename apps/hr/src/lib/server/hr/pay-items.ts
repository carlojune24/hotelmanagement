import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { employees, payItems, payrollBatches, payrollRunLines, payrollRuns } from '$lib/server/db/schema/index';
import { DEDUCTION_CATEGORIES, EARNING_CATEGORIES } from '$lib/pay-items-core';
import { applyPayItemsForEmployee } from './payroll';

export class PayItemError extends Error {}

interface Processed {
	start: string;
	end: string;
	status: string;
}

/** Locked or released payslip cutoffs of these people: payroll that has already been processed for them. */
async function processedFor(employeeIds: string[]): Promise<Map<string, Processed[]>> {
	const out = new Map<string, Processed[]>();
	if (employeeIds.length === 0) return out;
	const rows = await db
		.select({
			employeeId: payrollRunLines.employeeId,
			start: payrollRuns.cutoffStart,
			end: payrollRuns.cutoffEnd,
			status: payrollBatches.status
		})
		.from(payrollRunLines)
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
		.where(and(inArray(payrollRunLines.employeeId, employeeIds), inArray(payrollBatches.status, ['locked', 'released'])));
	for (const r of rows) (out.get(r.employeeId) ?? out.set(r.employeeId, []).get(r.employeeId)!).push(r);
	return out;
}

/**
 * Why an item can no longer be edited, or null. Payroll that is already processed (locked or released) for any
 * cutoff the item covers fixes it: a payslip never changes after the fact, so neither may the item behind it.
 */
function lockReasonOf(item: { startDate: string; endDate: string | null }, cuts: Processed[] | undefined): string | null {
	const hit = (cuts ?? []).filter((c) => c.start <= (item.endDate ?? '9999-12-31') && c.end >= item.startDate);
	if (hit.length === 0) return null;
	const released = hit.some((c) => c.status === 'released');
	const recurring = item.endDate !== item.startDate;
	if (!recurring) {
		const c = hit[0]!;
		return `Payroll for ${c.start} to ${c.end} is already ${released ? 'released' : 'locked'}.`;
	}
	return `Already paid on ${hit.length} ${released ? 'released or locked' : 'locked'} payslip${hit.length === 1 ? '' : 's'}. Archive it and file a new one from the next cutoff.`;
}
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.');

export const payItemSchema = z
	.object({
		employeeIds: z.array(z.string().uuid()).min(1, 'Pick at least one employee.').max(200),
		kind: z.enum(['earning', 'deduction']),
		category: z.enum(['allowance', 'incentive', 'cash_advance', 'other']),
		label: z.string().trim().min(1, 'Give it a name, it prints on the payslip.').max(80),
		amount: z.coerce.number().positive('The amount must be more than zero.').max(10_000_000),
		recurring: z.coerce.boolean().default(false),
		/** An earning that is exempt from income tax (de minimis and the like). Ignored for deductions. */
		exempt: z.coerce.boolean().default(false),
		startDate: isoDate,
		endDate: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), isoDate.nullable()),
		note: z.string().trim().max(300).default('')
	})
	.superRefine((v, ctx) => {
		const ok = (v.kind === 'earning' ? EARNING_CATEGORIES : DEDUCTION_CATEGORIES) as readonly string[];
		if (!ok.includes(v.category)) ctx.addIssue({ code: 'custom', path: ['category'], message: 'That type does not fit.' });
		if (v.recurring && v.endDate && v.endDate < v.startDate) {
			ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'The end date is before the start.' });
		}
	});

const centavos = (pesos: number) => Math.round(pesos * 100);

export type PayItemStatus = 'pending' | 'draft' | 'locked' | 'voided' | 'archived';

export async function listPayItems(organizationId: string) {
	const rows = await db
		.select({
			item: payItems,
			last: employees.lastName,
			first: employees.firstName,
			no: employees.employeeNo,
			batchStatus: payrollBatches.status,
			cutoffStart: payrollRuns.cutoffStart,
			cutoffEnd: payrollRuns.cutoffEnd
		})
		.from(payItems)
		.innerJoin(employees, eq(employees.id, payItems.employeeId))
		.leftJoin(payrollRunLines, eq(payrollRunLines.id, payItems.appliedLineId))
		.leftJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.leftJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
		.where(eq(payItems.organizationId, organizationId))
		.orderBy(desc(payItems.startDate), asc(employees.lastName));
	const processed = await processedFor([...new Set(rows.map((r) => r.item.employeeId))]);
	return rows.map((r) => {
		const lockReason =
			r.item.voidedAt || r.item.archivedAt ? null : lockReasonOf(r.item, processed.get(r.item.employeeId));
		const status: PayItemStatus = r.item.voidedAt
			? 'voided'
			: r.item.archivedAt
				? 'archived'
				: !r.item.appliedLineId
				? 'pending'
				: r.batchStatus === 'draft'
					? 'draft'
					: 'locked';
		return {
			id: r.item.id,
			employeeId: r.item.employeeId,
			employeeName: `${r.last}, ${r.first}`,
			employeeNo: r.no,
			kind: r.item.kind as 'earning' | 'deduction',
			category: r.item.category,
			label: r.item.label,
			taxable: r.item.taxable,
			amountCentavos: r.item.amountCentavos,
			startDate: r.item.startDate,
			endDate: r.item.endDate,
			note: r.item.note ?? '',
			voidReason: r.item.voidReason ?? '',
			status,
			recurring: r.item.endDate !== r.item.startDate,
			/** Set when payroll that covers this item is already processed: it can no longer be edited. */
			lockReason,
			cutoff: r.cutoffStart && r.cutoffEnd ? `${r.cutoffStart} to ${r.cutoffEnd}` : null
		};
	});
}

export async function createPayItems(organizationId: string, input: z.infer<typeof payItemSchema>, userId: string | null) {
	const people = await db
		.select({ id: employees.id })
		.from(employees)
		.where(and(eq(employees.organizationId, organizationId), inArray(employees.id, input.employeeIds), isNull(employees.deletedAt)));
	if (people.length !== new Set(input.employeeIds).size) throw new PayItemError('One of those employees no longer exists.');
	const endDate = input.recurring ? input.endDate : input.startDate;
	if (!input.recurring) {
		// A one-cutoff item for a cutoff that has already been processed would never be picked up.
		const processed = await processedFor(people.map((p) => p.id));
		for (const p of people) {
			const why = lockReasonOf({ startDate: input.startDate, endDate }, processed.get(p.id));
			if (why) throw new PayItemError(`${why} Pick a cutoff that is still open.`);
		}
	}
	const rows = await db
		.insert(payItems)
		.values(
			people.map((p) => ({
				organizationId,
				employeeId: p.id,
				kind: input.kind,
				category: input.category,
				label: input.label,
				taxable: !(input.kind === 'earning' && input.exempt),
				amountCentavos: centavos(input.amount),
				startDate: input.startDate,
				endDate,
				note: input.note || null,
				createdByUserId: userId
			}))
		)
		.returning({ id: payItems.id, employeeId: payItems.employeeId });
	// Draft payslips that fall in range pick it up now; locked ones are left alone.
	let reflected = 0;
	for (const p of people) reflected += await applyPayItemsForEmployee(p.id);
	return { created: rows, reflected };
}

export async function voidPayItem(id: string, reason: string) {
	const row = await db
		.select({ item: payItems, batchStatus: payrollBatches.status })
		.from(payItems)
		.leftJoin(payrollRunLines, eq(payrollRunLines.id, payItems.appliedLineId))
		.leftJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.where(eq(payItems.id, id))
		.then((r) => r.at(0));
	if (!row) throw new PayItemError('That item does not exist.');
	if (row.item.voidedAt) throw new PayItemError('That item is already voided.');
	if (row.batchStatus && row.batchStatus !== 'draft') {
		throw new PayItemError('It is already on a locked payslip. Unlock that batch first, or file a correcting item.');
	}
	if (row.item.endDate === row.item.startDate) {
		const why = lockReasonOf(row.item, (await processedFor([row.item.employeeId])).get(row.item.employeeId));
		if (why) throw new PayItemError(`${why} Unlock that batch first, or file a correcting item.`);
	}
	await db
		.update(payItems)
		.set({ voidedAt: new Date(), voidReason: reason.trim() || null, appliedLineId: null, updatedAt: new Date() })
		.where(eq(payItems.id, id));
	await applyPayItemsForEmployee(row.item.employeeId);
}

/** The payslip batch status an item is on, or null when it is on none. */
async function batchStatusOf(appliedLineId: string | null) {
	if (!appliedLineId) return null;
	const row = await db
		.select({ status: payrollBatches.status })
		.from(payrollRunLines)
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.where(eq(payrollRunLines.id, appliedLineId))
		.then((r) => r.at(0));
	return row?.status ?? null;
}

export const payItemEditSchema = z
	.object({
		id: z.string().uuid(),
		category: z.enum(['allowance', 'incentive', 'cash_advance', 'other']),
		label: z.string().trim().min(1, 'Give it a name, it prints on the payslip.').max(80),
		amount: z.coerce.number().positive('The amount must be more than zero.').max(10_000_000),
		recurring: z.coerce.boolean().default(false),
		exempt: z.coerce.boolean().default(false),
		startDate: isoDate,
		endDate: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), isoDate.nullable()),
		note: z.string().trim().max(300).default('')
	})
	.superRefine((v, ctx) => {
		if (v.recurring && v.endDate && v.endDate < v.startDate) {
			ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'The end date is before the start.' });
		}
	});

/**
 * Changes what an item says: its name, amount, type, tax treatment, dates and note. The person and whether it is
 * an earning or a deduction stay as filed (void it and file another for that). A payslip that is already locked
 * keeps what it was built with, so the item cannot be changed under it.
 */
export async function updatePayItem(organizationId: string, input: z.infer<typeof payItemEditSchema>) {
	const item = await db
		.select()
		.from(payItems)
		.where(and(eq(payItems.id, input.id), eq(payItems.organizationId, organizationId)))
		.then((r) => r.at(0));
	if (!item) throw new PayItemError('That item does not exist.');
	if (item.voidedAt) throw new PayItemError('A voided item cannot be edited. File a new one.');
	if (item.archivedAt) throw new PayItemError('Restore the item before editing it.');
	const status = await batchStatusOf(item.appliedLineId);
	if (status && status !== 'draft') {
		throw new PayItemError('It is already on a locked payslip. Unlock that batch first, or file a correcting item.');
	}
	const processed = (await processedFor([item.employeeId])).get(item.employeeId);
	const why = lockReasonOf(item, processed);
	if (why) throw new PayItemError(`${why} It can no longer be edited.`);
	const ok = (item.kind === 'earning' ? EARNING_CATEGORIES : DEDUCTION_CATEGORIES) as readonly string[];
	if (!ok.includes(input.category)) throw new PayItemError('That type does not fit.');
	const endDate = input.recurring ? input.endDate : input.startDate;
	// Moving a one-cutoff item into a cutoff that is already processed would leave it unpaid for good.
	if (!input.recurring) {
		const intoLocked = lockReasonOf({ startDate: input.startDate, endDate }, processed);
		if (intoLocked) throw new PayItemError(`${intoLocked} Pick a cutoff that is still open.`);
	}
	const [after] = await db
		.update(payItems)
		.set({
			category: input.category,
			label: input.label,
			amountCentavos: centavos(input.amount),
			taxable: !(item.kind === 'earning' && input.exempt),
			startDate: input.startDate,
			endDate,
			note: input.note || null,
			updatedAt: new Date()
		})
		.where(eq(payItems.id, item.id))
		.returning();
	const reflected = await applyPayItemsForEmployee(item.employeeId);
	return { before: item, after: after!, reflected };
}

/**
 * Archives an item that has run its course (or restores it): it stops being picked up by payroll and moves to the
 * Archived list, with no reason needed. Unlike voiding it does not say the item was a mistake. Refused while the
 * item sits on a locked payslip, as voiding is.
 */
export async function archivePayItem(organizationId: string, id: string, archive: boolean) {
	const item = await db
		.select()
		.from(payItems)
		.where(and(eq(payItems.id, id), eq(payItems.organizationId, organizationId)))
		.then((r) => r.at(0));
	if (!item) throw new PayItemError('That item does not exist.');
	if (item.voidedAt) throw new PayItemError('A voided item cannot be archived.');
	if (archive) {
		if (item.archivedAt) throw new PayItemError('That item is already archived.');
		if (item.endDate === item.startDate) {
			const status = await batchStatusOf(item.appliedLineId);
			const why = lockReasonOf(item, (await processedFor([item.employeeId])).get(item.employeeId));
			if ((status && status !== 'draft') || why) {
				throw new PayItemError(`${why ?? 'It is already on a locked payslip.'} Unlock that batch first.`);
			}
		}
		await db
			.update(payItems)
			.set({ archivedAt: new Date(), appliedLineId: null, updatedAt: new Date() })
			.where(eq(payItems.id, id));
	} else {
		if (!item.archivedAt) throw new PayItemError('That item is not archived.');
		await db.update(payItems).set({ archivedAt: null, updatedAt: new Date() }).where(eq(payItems.id, id));
	}
	const reflected = await applyPayItemsForEmployee(item.employeeId);
	return { item, reflected };
}
