import { count, eq } from 'drizzle-orm';
import { dev } from '$app/environment';
import { db } from '$lib/server/db/index';
import { hotels, users } from '$lib/server/db/schema/index';
import { getDevTunnelUrl } from '$lib/server/dev-tunnel';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [hotelCount] = await db.select({ n: count() }).from(hotels);
	const [publishedCount] = await db
		.select({ n: count() })
		.from(hotels)
		.where(eq(hotels.status, 'published'));
	const [userCount] = await db.select({ n: count() }).from(users);

	return {
		stats: {
			hotels: hotelCount?.n ?? 0,
			published: publishedCount?.n ?? 0,
			users: userCount?.n ?? 0
		},
		devTunnelUrl: dev ? getDevTunnelUrl() : null
	};
};
