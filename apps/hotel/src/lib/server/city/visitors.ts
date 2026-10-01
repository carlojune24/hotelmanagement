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
			// date - date is an integer number of nights in Postgres
			guestNights: sql<number>`coalesce(sum(${bookings.occupancy} * (${bookings.checkOut} - ${bookings.checkIn})), 0)::int`
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
		guestNights: Number(r.guestNights)
	}));

	return { range, report: buildVisitorReport(hotelRows, rows, monthsBetween(range.from, range.to)) };
}
