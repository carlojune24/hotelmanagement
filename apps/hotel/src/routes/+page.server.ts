import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const published = await db
		.select({ slug: hotels.slug, name: hotels.name, city: hotels.city })
		.from(hotels)
		.where(and(eq(hotels.status, 'published'), isNull(hotels.deletedAt)))
		.orderBy(asc(hotels.name));
	return { published };
};
