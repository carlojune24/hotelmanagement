import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { seedHotelAmenities } from '$lib/server/amenities/catalog';
import { seedFinanceDefaults } from '$lib/server/finance/seed-defaults';
import { seedDefaultRoles } from '$lib/server/auth/roles';
import { writeAudit } from '$lib/server/audit';
import { mintRef } from '$lib/server/ids';
import { slugError } from '$lib/server/tenant';
import type { SessionUser } from '$lib/server/auth/session';

export type CreateHotelResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Creates a draft hotel exactly the way /admin does (same slug rules, same seeding), shared by
 * `/city/hotels` and the application "finalize" step so there is one creation path on the city
 * instance. Runs against whatever DB the instance is pointed at (hotels_city on the city instance).
 */
export async function createHotelWithDefaults(
	input: { name: string; slug: string; addressLine?: string | null; city?: string | null },
	actor: SessionUser | null
): Promise<CreateHotelResult> {
	const slug = input.slug.toLowerCase().trim();
	const err = slugError(slug);
	if (err) return { ok: false, error: err };

	let id: string;
	try {
		const [row] = await db
			.insert(hotels)
			.values({
				name: input.name.trim(),
				slug,
				orgRef: mintRef('org'),
				addressLine: input.addressLine ?? null,
				city: input.city ?? null
			})
			.returning({ id: hotels.id });
		id = row!.id;
	} catch (e) {
		if (e instanceof Error && 'code' in e && (e as { code: string }).code === '23505') {
			return { ok: false, error: `The slug "${slug}" is already taken.` };
		}
		throw e;
	}

	// Standard amenity catalogue, a working Finance setup, and the default role set (so the first
	// hotel_admin invite has a role to grant).
	await seedHotelAmenities(db, id);
	await seedFinanceDefaults(db, id);
	await seedDefaultRoles(db, id);

	await writeAudit({
		actor,
		action: 'hotel.create',
		entityType: 'hotel',
		entityId: id,
		after: { slug, name: input.name }
	});
	return { ok: true, id };
}
