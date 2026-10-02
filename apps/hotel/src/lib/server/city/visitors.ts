import { and, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { bookings, hotels } from '$lib/server/db/schema/index';
import { todayManila } from '$lib/server/city/today';
import { monthsBetween, resolveRange } from '$lib/city/range';
import { VISIT_STATUSES, buildVisitorReport, type VisitorRow } from '$lib/city/visitors';

/**
 * Resolves the requested range and builds the guest report across all non-archived hotels.
 * A visit = a stay that is `checked_in`/`checked_out`, placed in the month (and range) of its check-in
 * date; guests = sum of `occupancy`, guest-nights = occupancy × nights.
 */
export async function visitorsForRequest(params: URLSearchParams) {
	const range = resolveRange(
		{ range: params.get('range'), from: params.get('from'), to: params.get('to') },
		todayManila()
	);

	const hotelRows = await db
		.select({ id: hotels.id, name: hotels.name, slug: hotels.slug })
		.from(hotels)
		.where(ne(hotels.status, 'archived'));

	const monthExpr = sql<string>`to_char(${bookings.checkIn}, 'YYYY-MM')`;
	const grouped = await db
		.select({
			hotelId: bookings.hotelId,
			month: monthExpr,
			guests: sql<number>`coalesce(sum(${bookings.occupancy}), 0)::int`,
			stays: sql<number>`count(*)::int`,
			// date - date is an integer number of nights in Postgres; the stay's own length, not × party size
			nights: sql<number>`coalesce(sum(${bookings.checkOut} - ${bookings.checkIn}), 0)::int`,
			guestNights: sql<number>`coalesce(sum(${bookings.occupancy} * (${bookings.checkOut} - ${bookings.checkIn})), 0)::int`,
			// Recorded at check-in and optional: sum()/count(col) both skip NULLs, so stays without a count drop out.
			tourists: sql<number>`coalesce(sum(${bookings.touristCount}), 0)::int`,
			touristStays: sql<number>`count(${bookings.touristCount})::int`
		})
		.from(bookings)
		.where(
			and(
				inArray(bookings.status, [...VISIT_STATUSES]),
				gte(bookings.checkIn, range.from),
				lte(bookings.checkIn, range.to)
			)
		)
		.groupBy(bookings.hotelId, monthExpr);

	const rows: VisitorRow[] = grouped.map((r) => ({
		hotelId: r.hotelId,
		month: r.month,
		guests: Number(r.guests),
		stays: Number(r.stays),
		nights: Number(r.nights),
		guestNights: Number(r.guestNights),
		tourists: Number(r.tourists),
		touristStays: Number(r.touristStays)
	}));

	return { range, report: buildVisitorReport(hotelRows, rows, monthsBetween(range.from, range.to)) };
}
