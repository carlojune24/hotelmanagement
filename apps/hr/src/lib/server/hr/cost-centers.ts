import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { costCenters, employees } from '$lib/server/db/schema/index';

export class CostCenterError extends Error {}

export const costCenterSchema = z.object({
	id: z.string().uuid().optional().or(z.literal('')),
	code: z
		.string()
		.trim()
		.min(1, 'Give it a code.')
		.max(30, 'The code is at most 30 characters.')
		.regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore in the code.'),
	name: z.string().trim().min(1, 'Give it a name.').max(80)
});

export async function listCostCenters(organizationId: string) {
	const rows = await db
		.select({
			id: costCenters.id,
			code: costCenters.code,
			name: costCenters.name,
			active: costCenters.active,
			people: sql<number>`count(${employees.id}) filter (where ${employees.deletedAt} is null)`.mapWith(Number)
		})
		.from(costCenters)
		.leftJoin(
			employees,
			and(eq(employees.organizationId, costCenters.organizationId), eq(employees.costCenter, costCenters.code))
		)
		.where(eq(costCenters.organizationId, organizationId))
		.groupBy(costCenters.id)
		.orderBy(asc(costCenters.code));
	return rows;
}

export async function saveCostCenter(organizationId: string, input: z.infer<typeof costCenterSchema>) {
	const dup = await db
		.select({ id: costCenters.id })
		.from(costCenters)
		.where(and(eq(costCenters.organizationId, organizationId), eq(costCenters.code, input.code)))
		.then((r) => r.at(0));
	if (input.id) {
		const current = await db
			.select()
			.from(costCenters)
			.where(and(eq(costCenters.id, input.id), eq(costCenters.organizationId, organizationId)))
			.then((r) => r.at(0));
		if (!current) throw new CostCenterError('That cost center does not exist.');
		if (dup && dup.id !== current.id) throw new CostCenterError(`Code ${input.code} is already used.`);
		// Renaming the code carries every employee who holds it; payslips already built keep the old one.
		await db.transaction(async (tx) => {
			await tx
				.update(costCenters)
				.set({ code: input.code, name: input.name, updatedAt: new Date() })
				.where(eq(costCenters.id, current.id));
			if (current.code !== input.code) {
				await tx
					.update(employees)
					.set({ costCenter: input.code, updatedAt: new Date() })
					.where(and(eq(employees.organizationId, organizationId), eq(employees.costCenter, current.code)));
			}
		});
		return { before: current, after: { ...current, code: input.code, name: input.name } };
	}
	if (dup) throw new CostCenterError(`Code ${input.code} is already used.`);
	const [row] = await db.insert(costCenters).values({ organizationId, code: input.code, name: input.name }).returning();
	return { before: null, after: row! };
}

export async function setCostCenterActive(organizationId: string, id: string, active: boolean) {
	const [row] = await db
		.update(costCenters)
		.set({ active, updatedAt: new Date() })
		.where(and(eq(costCenters.id, id), eq(costCenters.organizationId, organizationId)))
		.returning();
	if (!row) throw new CostCenterError('That cost center does not exist.');
	return row;
}

/**
 * A code typed on an employee must be on the list. Leaving it unchanged is always allowed (it may belong to a
 * since-deactivated cost center); picking a deactivated one for somebody new is not.
 */
export async function assertCostCenter(organizationId: string, code: string | undefined, unchangedFrom?: string | null) {
	const wanted = (code ?? '').trim();
	if (!wanted || wanted === (unchangedFrom ?? '')) return;
	const row = await db
		.select({ active: costCenters.active })
		.from(costCenters)
		.where(and(eq(costCenters.organizationId, organizationId), eq(costCenters.code, wanted)))
		.then((r) => r.at(0));
	if (!row) throw new CostCenterError(`"${wanted}" is not on the cost center list. Add it under Settings → Cost centers.`);
	if (!row.active) throw new CostCenterError(`Cost center ${wanted} is inactive.`);
}

/** code → name for a company, used when freezing the cost center onto payslips. */
export async function costCenterNames(organizationId: string) {
	const rows = await db
		.select({ code: costCenters.code, name: costCenters.name })
		.from(costCenters)
		.where(and(eq(costCenters.organizationId, organizationId), isNotNull(costCenters.code)));
	return new Map(rows.map((r) => [r.code, r.name]));
}
