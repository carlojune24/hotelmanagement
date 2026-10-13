import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from './db/index';
import { establishmentTypes, establishments, organizations } from './db/schema/index';
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

/** The type an establishment is being created or moved to — must exist, be in use, and belong to this company. */
async function activeType(organizationId: string, typeId: string) {
	const type = await db
		.select()
		.from(establishmentTypes)
		.where(and(eq(establishmentTypes.id, typeId), eq(establishmentTypes.organizationId, organizationId)))
		.then((r) => r.at(0));
	if (!type || !type.active) throw new EstablishmentError('Choose an establishment type that is in use.');
	return type;
}

export async function createEstablishment(input: EstablishmentInput) {
	const org = await getOrganization();
	const type = await activeType(org.id, input.typeId);
	const kind = type.linksToHotelApp ? 'hotel' : 'business';
	const slug = await uniqueSlug(input.name, async (candidate) => {
		const hit = await db
			.select({ id: establishments.id })
			.from(establishments)
			.where(eq(establishments.slug, candidate))
			.then((r) => r.at(0));
		return !!hit;
	});
	// A given hotel reference is stored exactly as given: it must match the hotel app's value byte
	// for byte. A hotel not set up in the hotel app yet (or a business) gets a minted one.
	const orgRef = kind === 'hotel' && input.orgRef ? input.orgRef : mintRef('org');
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
			kind,
			typeId: type.id,
			timezone: input.timezone,
			legalName: input.legalName || null,
			addressLine: input.addressLine || null,
			city: input.city || null
		})
		.returning();
	return row!;
}

/** A hotel-style type can't become a non-hotel one or back (that changes what the establishment is);
 *  moving between types of the same behaviour is fine. A hotel's reference may be (re)linked. */
export async function updateEstablishment(
	id: string,
	input: Pick<EstablishmentInput, 'name' | 'timezone' | 'legalName' | 'addressLine' | 'city'> & {
		status?: 'active' | 'archived';
		/** Hotels only: link to (or re-point at) the hotel app's record. */
		orgRef?: string;
		typeId?: string;
	}
) {
	let typeId: string | undefined;
	if (input.typeId) {
		const org = await getOrganization();
		const next = await activeType(org.id, input.typeId);
		const cur = await db
			.select({ linksToHotelApp: establishmentTypes.linksToHotelApp, kind: establishments.kind })
			.from(establishments)
			.leftJoin(establishmentTypes, eq(establishmentTypes.id, establishments.typeId))
			.where(eq(establishments.id, id))
			.then((r) => r.at(0));
		if (!cur) throw new EstablishmentError('Establishment not found.');
		const wasHotel = cur.linksToHotelApp ?? cur.kind === 'hotel';
		if (wasHotel !== next.linksToHotelApp) {
			throw new EstablishmentError('A hotel cannot be changed to another type, or the other way round.');
		}
		typeId = next.id;
	}
	if (input.orgRef) {
		const current = await db
			.select({ kind: establishments.kind, orgRef: establishments.orgRef })
			.from(establishments)
			.where(eq(establishments.id, id))
			.then((r) => r.at(0));
		if (!current) throw new EstablishmentError('Establishment not found.');
		if (current.kind !== 'hotel') throw new EstablishmentError('Only a hotel can be linked to the hotel app.');
		if (current.orgRef !== input.orgRef) {
			const dupe = await db
				.select({ id: establishments.id })
				.from(establishments)
				.where(eq(establishments.orgRef, input.orgRef))
				.then((r) => r.at(0));
			if (dupe) throw new EstablishmentError('That hotel is already registered.');
		}
	}
	const [row] = await db
		.update(establishments)
		.set({
			...(input.orgRef ? { orgRef: input.orgRef } : {}),
			...(typeId ? { typeId } : {}),
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
