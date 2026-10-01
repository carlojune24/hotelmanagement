import { fail, redirect } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { createHotelWithDefaults } from '$lib/server/city/create-hotel';
import { requirePlatformAdmin } from '$lib/server/auth/rbac';
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
		requirePlatformAdmin(event.locals.user);
		const parsed = createSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Enter a name and slug.' });

		const result = await createHotelWithDefaults(
			{ name: parsed.data.name, slug: parsed.data.slug },
			event.locals.user
		);
		if (!result.ok) return fail(400, { error: result.error });
		redirect(303, `/city/hotels/${result.id}`);
	}
};
