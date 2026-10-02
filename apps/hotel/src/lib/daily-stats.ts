/**
 * Daily operating statistics a hotel exposes at `GET /api/v1/stats/daily` — what a tourism
 * office needs and nothing personal: counts and pesos per business date, no guest names or contacts.
 * Pure shaping + range validation; the queries live in `lib/server/api/daily-stats.ts`.
 *
 * Definitions (same as the city reports): a stay counts only when `checked_in`/`checked_out`; room-nights
 * are nights × rooms booked, placed on each night of the stay; room revenue is the stay's pre-VAT room
 * subtotal spread evenly over its nights; guests/tourists are counted on the stay's check-in date.
 */
import { addDays, isValidISO } from './finance-range';

export const MAX_DAILY_STATS_DAYS = 400;

export type CashLine = { category: string; direction: string; amount_minor: number };

export type DailyStatsRow = {
	hotel_id: string;
	date: string;
	/** Active rooms now (history of room changes isn't kept). */
	rooms_available: number;
	room_nights_sold: number;
	room_revenue_minor: number;
	/** Person-nights: party size of every stay that has this night. */
	guest_nights: number;
	stays_arrived: number;
	guests_arrived: number;
	/** Tourists staff recorded at check-in, summed over arrivals that carry a count. */
	tourists_recorded: number;
	stays_with_tourist_count: number;
	/** Non-voided cash movements booked on this business date, by category and direction. */
	cash: CashLine[];
};

export type DailyStatsInputs = {
	hotels: { id: string; today: string; rooms: number }[];
	nights: { hotelId: string; date: string; roomNights: number; guestNights: number; revenueMinor: number }[];
	arrivals: {
		hotelId: string;
		date: string;
		stays: number;
		guests: number;
		tourists: number;
		touristStays: number;
	}[];
	cash: { hotelId: string; date: string; category: string; direction: string; amountMinor: number }[];
};

export function dateList(from: string, to: string): string[] {
	const out: string[] = [];
	for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
	return out;
}

export type RangeResult = { ok: true; from: string; to: string } | { ok: false; message: string };

export function validateRange(from: string | null, to: string | null): RangeResult {
	if (!isValidISO(from) || !isValidISO(to)) return { ok: false, message: 'from and to must be YYYY-MM-DD dates.' };
	if (from > to) return { ok: false, message: 'from must not be after to.' };
	if (dateList(from, to).length > MAX_DAILY_STATS_DAYS) {
		return { ok: false, message: `Range is limited to ${MAX_DAILY_STATS_DAYS} days.` };
	}
	return { ok: true, from, to };
}

/** One row per hotel per date in the range, up to that hotel's own "today" — a quiet day is a row of zeros. */
export function buildDailyStats(from: string, to: string, input: DailyStatsInputs): DailyStatsRow[] {
	const key = (hotelId: string, date: string) => `${hotelId}|${date}`;
	const nights = new Map(input.nights.map((n) => [key(n.hotelId, n.date), n]));
	const arrivals = new Map(input.arrivals.map((a) => [key(a.hotelId, a.date), a]));
	const cash = new Map<string, CashLine[]>();
	for (const c of input.cash) {
		const k = key(c.hotelId, c.date);
		const list = cash.get(k) ?? [];
		list.push({ category: c.category, direction: c.direction, amount_minor: c.amountMinor });
		cash.set(k, list);
	}

	const rows: DailyStatsRow[] = [];
	for (const h of input.hotels) {
		for (const date of dateList(from, to)) {
			if (date > h.today) break;
			const k = key(h.id, date);
			const n = nights.get(k);
			const a = arrivals.get(k);
			rows.push({
				hotel_id: h.id,
				date,
				rooms_available: h.rooms,
				room_nights_sold: n?.roomNights ?? 0,
				room_revenue_minor: n?.revenueMinor ?? 0,
				guest_nights: n?.guestNights ?? 0,
				stays_arrived: a?.stays ?? 0,
				guests_arrived: a?.guests ?? 0,
				tourists_recorded: a?.tourists ?? 0,
				stays_with_tourist_count: a?.touristStays ?? 0,
				cash: cash.get(k) ?? []
			});
		}
	}
	return rows;
}
