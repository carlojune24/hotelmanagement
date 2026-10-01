import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { bookings, hotels, rooms } from '$lib/server/db/schema/index';
import { todayManila } from '$lib/server/city/today';
import { monthsBetween, resolveRange } from '$lib/city/range';
import { VISIT_STATUSES } from '$lib/city/visitors';
import { buildOccupancyReport, type SoldRow } from '$lib/city/occupancy';

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Occupancy & rates across all non-archived hotels. Sold room-nights and room revenue come from stays that
 * are `checked_in`/`checked_out`, split across the months of the range by the nights that fall in each
 * (nights up to and including today at most). See `lib/city/occupancy.ts` for the definitions.
 */
export async function occupancyForRequest(params: URLSearchParams) {
	const today = todayManila();
	const range = resolveRange(
		{ range: params.get('range'), from: params.get('from'), to: params.get('to') },
		today
	);
	const months = monthsBetween(range.from, range.to);
	// Nights are counted for [from, lastDay]; lastDay never passes today. `toExcl` is exclusive.
	const lastDay = range.to < today ? range.to : today;
	const toExcl = nextDay(lastDay);

	const hotelRows = await db
		.select({
			id: hotels.id,
			name: hotels.name,
			slug: hotels.slug,
			rooms: sql<number>`count(${rooms.id}) filter (where ${rooms.isActive})::int`
		})
		.from(hotels)
		.leftJoin(rooms, eq(rooms.hotelId, hotels.id))
		.where(ne(hotels.status, 'archived'))
		.groupBy(hotels.id, hotels.name, hotels.slug);

	const openedRows = await db
		.select({ hotelId: bookings.hotelId, first: sql<string>`min(${bookings.checkIn})::text` })
		.from(bookings)
		.where(and(inArray(bookings.status, [...VISIT_STATUSES])))
		.groupBy(bookings.hotelId);

	// One row per hotel per month: nights of each qualifying stay inside that month, × rooms booked,
	// with the stay's pre-VAT room subtotal spread evenly over its nights.
	const soldResult = await db.execute<{ hotelId: string; month: string; roomNights: number; revenue: string }>(sql`
		select b.hotel_id as "hotelId",
		       to_char(m.start, 'YYYY-MM') as month,
		       sum(o.nights * br.qty)::int as "roomNights",
		       round(sum(b.subtotal_centavos::numeric * o.nights / nullif(b.check_out - b.check_in, 0)))::text as revenue
		from bookings b
		join (select booking_id, sum(quantity)::int as qty from booking_rooms group by booking_id) br
		  on br.booking_id = b.id
		cross join generate_series(
		  date_trunc('month', ${range.from}::timestamp),
		  date_trunc('month', ${range.to}::timestamp),
		  interval '1 month') as m(start)
		cross join lateral (
		  select greatest(0,
		    least(b.check_out, (m.start + interval '1 month')::date, ${toExcl}::date)
		    - greatest(b.check_in, m.start::date, ${range.from}::date)) as nights
		) o
		where b.status in ('checked_in', 'checked_out')
		  and b.check_in < ${toExcl}::date and b.check_out > ${range.from}::date
		  and o.nights > 0
		group by 1, 2`);

	const sold: SoldRow[] = [...soldResult].map((r) => ({
		hotelId: r.hotelId,
		month: r.month,
		roomNights: Number(r.roomNights),
		revenueCentavos: Number(r.revenue)
	}));

	return {
		range,
		today,
		report: buildOccupancyReport({
			hotels: hotelRows.map((h) => ({ ...h, rooms: Number(h.rooms) })),
			openedOn: new Map(openedRows.map((r) => [r.hotelId, r.first])),
			sold,
			range,
			today,
			months
		})
	};
}
