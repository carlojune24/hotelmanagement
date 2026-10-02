import { and, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { cashMovements, hotels, rooms } from '$lib/server/db/schema/index';
import { businessDateFor } from '$lib/server/finance/shared';
import { buildDailyStats, type DailyStatsInputs } from '$lib/daily-stats';

const VISIT = sql`('checked_in', 'checked_out')`;
const ids = (hotelIds: string[]) => sql.join(hotelIds.map((i) => sql`${i}::uuid`), sql`, `);

/**
 * Daily operating stats for the given hotels over `[from, to]` (inclusive, already validated).
 * Definitions are in `lib/daily-stats.ts`; they match the city reports so the two never disagree.
 */
export async function dailyStatsFor(hotelIds: string[], from: string, to: string) {
	if (hotelIds.length === 0) return [];

	const hotelRows = await db
		.select({
			id: hotels.id,
			timezone: hotels.timezone,
			rooms: sql<number>`count(${rooms.id}) filter (where ${rooms.isActive})::int`
		})
		.from(hotels)
		.leftJoin(rooms, sql`${rooms.hotelId} = ${hotels.id}`)
		.where(inArray(hotels.id, hotelIds))
		.groupBy(hotels.id, hotels.timezone);

	const input: DailyStatsInputs = {
		hotels: hotelRows.map((h) => ({ id: h.id, today: businessDateFor(h.timezone), rooms: Number(h.rooms) })),
		nights: [],
		arrivals: [],
		cash: []
	};
	// No hotel can have stats past the latest "today" among them; keeps the series bounded.
	const last = input.hotels.reduce((m, h) => (h.today > m ? h.today : m), from);
	const upTo = to < last ? to : last;
	if (upTo < from) return buildDailyStats(from, to, input);

	const nightRows = await db.execute<{
		hotelId: string; date: string; roomNights: number; guestNights: number; revenue: string;
	}>(sql`
		select b.hotel_id as "hotelId", to_char(d.day, 'YYYY-MM-DD') as date,
		       sum(br.qty)::int as "roomNights",
		       sum(b.occupancy)::int as "guestNights",
		       round(sum(b.subtotal_centavos::numeric / nullif(b.check_out - b.check_in, 0)))::text as revenue
		from generate_series(${from}::date, ${upTo}::date, interval '1 day') as d(day)
		join bookings b on b.check_in <= d.day::date and b.check_out > d.day::date
		join (select booking_id, sum(quantity)::int as qty from booking_rooms group by booking_id) br
		  on br.booking_id = b.id
		where b.hotel_id in (${ids(hotelIds)}) and b.status in ${VISIT}
		group by 1, 2`);

	const arrivalRows = await db.execute<{
		hotelId: string; date: string; stays: number; guests: number; tourists: number; touristStays: number;
	}>(sql`
		select b.hotel_id as "hotelId", to_char(b.check_in, 'YYYY-MM-DD') as date,
		       count(*)::int as stays,
		       coalesce(sum(b.occupancy), 0)::int as guests,
		       coalesce(sum(b.tourist_count), 0)::int as tourists,
		       count(b.tourist_count)::int as "touristStays"
		from bookings b
		where b.hotel_id in (${ids(hotelIds)}) and b.status in ${VISIT}
		  and b.check_in between ${from}::date and ${upTo}::date
		group by 1, 2`);

	const cashRows = await db
		.select({
			hotelId: cashMovements.hotelId,
			date: sql<string>`${cashMovements.businessDate}::text`,
			category: cashMovements.category,
			direction: cashMovements.direction,
			amount: sql<string>`coalesce(sum(${cashMovements.amountCentavos}), 0)::text`
		})
		.from(cashMovements)
		.where(
			and(
				inArray(cashMovements.hotelId, hotelIds),
				gte(cashMovements.businessDate, from),
				lte(cashMovements.businessDate, upTo),
				sql`${cashMovements.voidedAt} is null`
			)
		)
		.groupBy(cashMovements.hotelId, cashMovements.businessDate, cashMovements.category, cashMovements.direction);

	input.nights = [...nightRows].map((r) => ({
		hotelId: r.hotelId, date: r.date, roomNights: Number(r.roomNights),
		guestNights: Number(r.guestNights), revenueMinor: Number(r.revenue)
	}));
	input.arrivals = [...arrivalRows].map((r) => ({
		hotelId: r.hotelId, date: r.date, stays: Number(r.stays), guests: Number(r.guests),
		tourists: Number(r.tourists), touristStays: Number(r.touristStays)
	}));
	input.cash = cashRows.map((r) => ({
		hotelId: r.hotelId, date: r.date, category: r.category, direction: r.direction, amountMinor: Number(r.amount)
	}));

	return buildDailyStats(from, to, input);
}
