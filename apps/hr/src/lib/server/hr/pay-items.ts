import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { employees, payItems, payrollBatches, payrollRunLines, payrollRuns } from '$lib/server/db/schema/index';
import { DEDUCTION_CATEGORIES, EARNING_CATEGORIES } from '$lib/pay-items-core';
import { applyPayItemsForEmployee } from './payroll';

export class PayItemError extends Error {}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.');

export const payItemSchema = z
	.object({
		employeeIds: z.array(z.string().uuid()).min(1, 'Pick at least one employee.').max(200),
		kind: z.enum(['earning', 'deduction']),
		category: z.enum(['allowance', 'incentive', 'cash_advance', 'other']),
		label: z.string().trim().min(1, 'Give it a name, it prints on the payslip.').max(80),
		amount: z.coerce.number().positive('The amount must be more than zero.').max(10_000_000),
		recurring: z.coerce.boolean().default(false),
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

export type PayItemStatus = 'pending' | 'draft' | 'locked' | 'voided';

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
	return rows.map((r) => {
		const status: PayItemStatus = r.item.voidedAt
			? 'voided'
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
			amountCentavos: r.item.amountCentavos,
			startDate: r.item.startDate,
			endDate: r.item.endDate,
			note: r.item.note ?? '',
			voidReason: r.item.voidReason ?? '',
			status,
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
	const rows = await db
		.insert(payItems)
		.values(
			people.map((p) => ({
				organizationId,
				employeeId: p.id,
				kind: input.kind,
				category: input.category,
				label: input.label,
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
	await db
		.update(payItems)
		.set({ voidedAt: new Date(), voidReason: reason.trim() || null, appliedLineId: null, updatedAt: new Date() })
		.where(eq(payItems.id, id));
	await applyPayItemsForEmployee(row.item.employeeId);
}
