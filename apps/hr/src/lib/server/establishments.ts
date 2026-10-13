import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from './db/index';
import { establishments, organizations } from './db/schema/index';
import { mintRef } from './ids';
import { uniqueSlug } from '$lib/slug';
import { establishmentSchema, type EstablishmentInput } from '$lib/establishment-schema';

export class EstablishmentError extends Error {}

export { establishmentSchema, type EstablishmentInput };

export async function getOrganization() {
	const org = await db.select().from(organizations).limit(1).then((r) => r.at(0));
	if (!org) throw new EstablishmentError('No organization exists yet — run `pnpm db:seed`.');
	return org;
}

/** `ids` = restrict to these establishments (a manager's scope); omit for the whole company. */
export async function listEstablishments(ids?: string[]) {
	const where = ids
		? and(isNull(establishments.deletedAt), inArray(establishments.id, ids))
		: isNull(establishments.deletedAt);
	if (ids && ids.length === 0) return [];
	return db.select().from(establishments).where(where).orderBy(asc(establishments.name));
}

export async function loadEstablishmentBySlug(slug: string) {
	return db
		.select()
		.from(establishments)
		.where(and(eq(establishments.slug, slug), isNull(establishments.deletedAt)))
		.then((r) => r.at(0) ?? null);
}

export async function createEstablishment(input: EstablishmentInput) {
	const org = await getOrganization();
	const slug = await uniqueSlug(input.name, async (candidate) => {
		const hit = await db
			.select({ id: establishments.id })
			.from(establishments)
			.where(eq(establishments.slug, candidate))
			.then((r) => r.at(0));
		return !!hit;
	});
	// Stored exactly as given: it must match the hotel app's value byte for byte.
	const orgRef = input.kind === 'hotel' ? input.orgRef! : mintRef('org');
	const dupe = await db
		.select({ id: establishments.id })
		.from(establishments)
		.where(eq(establishments.orgRef, orgRef))
		.then((r) => r.at(0));
	if (dupe) throw new EstablishmentError('That hotel is already registered.');
	const [row] = await db
		.insert(establishments)
		.values({
			organizationId: org.id,
			orgRef,
			slug,
			name: input.name,
			kind: input.kind,
			timezone: input.timezone,
			legalName: input.legalName || null,
			addressLine: input.addressLine || null,
			city: input.city || null
		})
		.returning();
	return row!;
}

/** Kind and org reference are identity — set once, never edited (docs/HR_PLAN.md §6). */
export async function updateEstablishment(
	id: string,
	input: Pick<EstablishmentInput, 'name' | 'timezone' | 'legalName' | 'addressLine' | 'city'> & {
		status?: 'active' | 'archived';
	}
) {
	const [row] = await db
		.update(establishments)
		.set({
			name: input.name,
			timezone: input.timezone,
			legalName: input.legalName || null,
			addressLine: input.addressLine || null,
			city: input.city || null,
			...(input.status ? { status: input.status } : {}),
			updatedAt: new Date()
		})
		.where(and(eq(establishments.id, id), isNull(establishments.deletedAt)))
		.returning();
	if (!row) throw new EstablishmentError('Establishment not found.');
	return row;
}
