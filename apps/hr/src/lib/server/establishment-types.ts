import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { establishmentTypes, establishments } from '$lib/server/db/schema/index';
import { EstablishmentError } from './establishments';

export const typeSchema = z.object({
	name: z.string().trim().min(2, 'Give the type a name.').max(60)
});
export const newTypeSchema = typeSchema.extend({ linksToHotelApp: z.boolean().default(false) });

/** Types with how many establishments use each; seeds Hotel/Other for an organization with none yet. */
export async function listEstablishmentTypes(organizationId: string) {
	let rows = await db.select().from(establishmentTypes).where(eq(establishmentTypes.organizationId, organizationId));
	if (rows.length === 0) {
		await db
			.insert(establishmentTypes)
			.values([
				{ organizationId, name: 'Hotel', linksToHotelApp: true },
				{ organizationId, name: 'Other', linksToHotelApp: false }
			])
			.onConflictDoNothing();
		rows = await db.select().from(establishmentTypes).where(eq(establishmentTypes.organizationId, organizationId));
	}
	const used = await db
		.select({ typeId: establishments.typeId, n: sql<number>`count(*)::int` })
		.from(establishments)
		.where(sql`${establishments.deletedAt} is null`)
		.groupBy(establishments.typeId);
	const count = new Map(used.map((u) => [u.typeId, u.n]));
	return rows
		.map((r) => ({ ...r, establishmentCount: count.get(r.id) ?? 0 }))
		.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

export async function createEstablishmentType(organizationId: string, input: z.infer<typeof newTypeSchema>) {
	const existing = await listEstablishmentTypes(organizationId);
	if (existing.some((t) => t.name.toLowerCase() === input.name.toLowerCase())) {
		throw new EstablishmentError('An establishment type with that name already exists.');
	}
	const [row] = await db
		.insert(establishmentTypes)
		.values({ organizationId, name: input.name, linksToHotelApp: input.linksToHotelApp })
		.returning();
	return row!;
}

/** Rename or retire. Whether it links to the hotel app is fixed — establishments are already built on it. */
export async function updateEstablishmentType(
	organizationId: string,
	id: string,
	input: z.infer<typeof typeSchema> & { active: boolean }
) {
	const current = await db
		.select()
		.from(establishmentTypes)
		.where(and(eq(establishmentTypes.id, id), eq(establishmentTypes.organizationId, organizationId)))
		.then((r) => r.at(0));
	if (!current) throw new EstablishmentError('That establishment type does not exist.');
	const all = await db
		.select({ id: establishmentTypes.id, name: establishmentTypes.name })
		.from(establishmentTypes)
		.where(eq(establishmentTypes.organizationId, organizationId))
		.orderBy(asc(establishmentTypes.name));
	if (all.some((t) => t.id !== id && t.name.toLowerCase() === input.name.toLowerCase())) {
		throw new EstablishmentError('An establishment type with that name already exists.');
	}
	const [row] = await db
		.update(establishmentTypes)
		.set({ name: input.name, active: input.active, updatedAt: new Date() })
		.where(eq(establishmentTypes.id, id))
		.returning();
	return { before: current, after: row! };
}
