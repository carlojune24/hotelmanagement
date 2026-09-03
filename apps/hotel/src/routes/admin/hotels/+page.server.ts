import { fail, redirect } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { seedHotelAmenities } from '$lib/server/amenities/catalog';
import { writeAudit } from '$lib/server/audit';
import { mintRef } from '$lib/server/ids';
import { slugError } from '$lib/server/tenant';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const rows = await db
		.select({
			id: hotels.id,
			slug: hotels.slug,
			name: hotels.name,
			status: hotels.status,
			city: hotels.city
		})
		.from(hotels)
		.orderBy(asc(hotels.name));
	return { hotels: rows };
};

const createSchema = z.object({
	name: z.string().min(2).max(160),
	slug: z.string().min(3).max(40)
});

export const actions: Actions = {
	create: async (event) => {
		const parsed = createSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Enter a name and slug.' });

		const slug = parsed.data.slug.toLowerCase().trim();
		const slugErr = slugError(slug);
		if (slugErr) return fail(400, { error: slugErr });

		let newId: string;
		try {
			const [row] = await db
				.insert(hotels)
				.values({ name: parsed.data.name.trim(), slug, orgRef: mintRef('org') })
				.returning({ id: hotels.id });
			newId = row!.id;
		} catch (e) {
			if (e instanceof Error && 'code' in e && (e as { code: string }).code === '23505') {
				return fail(400, { error: `The slug "${slug}" is already taken.` });
			}
			throw e;
		}

		// Give the new hotel the standard amenity catalogue to start from.
		await seedHotelAmenities(db, newId);

		await writeAudit({
			actor: event.locals.user,
			action: 'hotel.create',
			entityType: 'hotel',
			entityId: newId,
			after: { slug, name: parsed.data.name }
		});
		redirect(303, `/admin/hotels/${newId}`);
	}
};
