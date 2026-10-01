import { asc, count, avg, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db/index';
import { hotels, reviews, rooms } from '$lib/server/db/schema/index';
import { parseBranding } from '$lib/server/branding';
import { firstHotelSlugForUser } from '$lib/server/auth/login';
import {
	buildDirectory,
	overallRating,
	parseSort,
	type DirectoryHotel
} from '$lib/city/directory';
import type { PageServerLoad } from './$types';

/**
 * City branch: `/` is the public hotel directory (hotels + ratings) instead of a redirect.
 * Only published hotels are listed; ratings are the mean of *approved* reviews, never invented.
 * Signed-in visitors get a link to their own dashboard rather than being redirected away.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const q = url.searchParams.get('q') ?? '';
	const sort = parseSort(url.searchParams.get('sort'));

	const published = await db
		.select({ id: hotels.id, slug: hotels.slug, name: hotels.name, city: hotels.city, config: hotels.config })
		.from(hotels)
		.where(eq(hotels.status, 'published'))
		.orderBy(asc(hotels.name));

	const ratingRows = await db
		.select({ hotelId: reviews.hotelId, avg: avg(reviews.rating), n: count() })
		.from(reviews)
		.where(eq(reviews.status, 'approved'))
		.groupBy(reviews.hotelId);
	const roomRows = await db
		.select({ hotelId: rooms.hotelId, n: count() })
		.from(rooms)
		.where(eq(rooms.isActive, true))
		.groupBy(rooms.hotelId);

	const list: DirectoryHotel[] = published.map((h) => {
		const b = parseBranding(h.config);
		return { id: h.id, slug: h.slug, name: h.name, city: h.city, photoUrl: b.heroImageUrl ?? b.logoUrl ?? null };
	});

	const ratings = new Map(ratingRows.map((r) => [r.hotelId, { avg: Number(r.avg), count: r.n }]));
	const roomCounts = new Map(roomRows.map((r) => [r.hotelId, r.n]));
	const all = buildDirectory(list, ratings, roomCounts, { q: '', sort });
	const rows = q.trim() ? buildDirectory(list, ratings, roomCounts, { q, sort }) : all;

	// Where "my dashboard" goes: city superadmins → /city, hotel staff → their hotel.
	let dashboardHref: string | null = null;
	if (locals.user) {
		if (locals.user.isPlatformAdmin) dashboardHref = '/city';
		else {
			const slug = await firstHotelSlugForUser(locals.user.id);
			if (slug) dashboardHref = `/${slug}/management/dashboard`;
		}
	}

	return {
		cityName: env.CITY_NAME?.trim() || 'City',
		rows,
		q,
		sort,
		totals: {
			hotels: all.length,
			rooms: all.reduce((s, r) => s + r.rooms, 0),
			overall: overallRating(all)
		},
		signedIn: !!locals.user,
		dashboardHref
	};
};
