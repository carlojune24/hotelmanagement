import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { hotels, reviews } from '$lib/server/db/schema/index';
import { todayManila } from '$lib/server/city/today';
import { resolveRange } from '$lib/city/range';
import { buildRatingsReport, type PendingRow, type RatingRow } from '$lib/city/ratings';

/** A review's date as the city sees it: its submission instant on Manila's calendar. */
const submittedDay = sql<string>`((${reviews.submittedAt} at time zone 'Asia/Manila')::date)`;

/**
 * Ratings across all non-archived hotels. Ratings and the latest-reviews list use APPROVED reviews
 * submitted within the range; the moderation backlog is every review pending right now (not range-bound).
 */
export async function ratingsForRequest(params: URLSearchParams) {
	const range = resolveRange(
		{ range: params.get('range'), from: params.get('from'), to: params.get('to') },
		todayManila()
	);
	const inRange = sql`${submittedDay} between ${range.from}::date and ${range.to}::date`;

	const hotelRows = await db
		.select({ id: hotels.id, name: hotels.name, slug: hotels.slug })
		.from(hotels)
		.where(ne(hotels.status, 'archived'));

	const ratingRows: RatingRow[] = (
		await db
			.select({ hotelId: reviews.hotelId, rating: reviews.rating, count: sql<number>`count(*)::int` })
			.from(reviews)
			.where(and(eq(reviews.status, 'approved'), inRange))
			.groupBy(reviews.hotelId, reviews.rating)
	).map((r) => ({ hotelId: r.hotelId, rating: r.rating, count: Number(r.count) }));

	const pendingRows: PendingRow[] = (
		await db
			.select({
				hotelId: reviews.hotelId,
				count: sql<number>`count(*)::int`,
				oldest: sql<string>`min(${submittedDay})::text`
			})
			.from(reviews)
			.where(eq(reviews.status, 'pending'))
			.groupBy(reviews.hotelId)
	).map((r) => ({ hotelId: r.hotelId, count: Number(r.count), oldest: r.oldest }));

	const latest = await db
		.select({
			id: reviews.id,
			hotelName: hotels.name,
			hotelId: hotels.id,
			rating: reviews.rating,
			comment: reviews.comment,
			guest: reviews.guestDisplayName,
			day: submittedDay
		})
		.from(reviews)
		.innerJoin(hotels, eq(hotels.id, reviews.hotelId))
		.where(and(eq(reviews.status, 'approved'), ne(hotels.status, 'archived'), inRange))
		.orderBy(desc(reviews.submittedAt))
		.limit(8);

	return {
		range,
		report: buildRatingsReport(hotelRows, ratingRows, pendingRows),
		latest: latest.map((r) => ({ ...r, day: String(r.day) }))
	};
}
