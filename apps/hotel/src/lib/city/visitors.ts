/**
 * City guest/visitor report — pure shaping. A "guest" is a person who actually stayed: the sum of
 * `bookings.occupancy` (the party's total head-count) over stays whose status is `checked_in` or
 * `checked_out`, counted in the month of their check-in date. Cancelled, no-show, pending and merely
 * confirmed (future) bookings are not visitors. DB access lives in `lib/server/city/visitors.ts`.
 */

/** Booking statuses that count as an actual visit. */
export const VISIT_STATUSES = ['checked_in', 'checked_out'] as const;

/** One grouped row: a hotel's stays that checked in during a `YYYY-MM` month. */
export type VisitorRow = {
	hotelId: string;
	month: string;
	guests: number;
	stays: number;
	/** Nights summed over the stays themselves (check-out minus check-in), regardless of party size. */
	nights: number;
	/** Party size × nights, summed — person-nights. */
	guestNights: number;
	/** Tourists staff recorded at check-in (`bookings.tourist_count`), summed over stays that have one. */
	tourists: number;
	/** How many of `stays` carry a recorded tourist count — the rest are simply not counted. */
	touristStays: number;
};

export type HotelVisitors = {
	id: string;
	name: string;
	slug: string;
	guests: number;
	stays: number;
	nights: number;
	guestNights: number;
	tourists: number;
	touristStays: number;
	/** Average length of stay in nights (stay nights ÷ stays), 1 decimal; null with no stays. */
	avgNights: number | null;
	monthly: { month: string; guests: number }[];
};

export type VisitorReport = {
	months: { month: string; guests: number }[];
	/** Recorded tourists per month, all hotels — only stays with a count at check-in. */
	touristMonths: { month: string; tourists: number }[];
	hotels: HotelVisitors[];
	totals: {
		guests: number;
		stays: number;
		nights: number;
		guestNights: number;
		tourists: number;
		touristStays: number;
		avgNights: number | null;
	};
	/** Hotels with at least one visitor in the range. */
	reporting: number;
	/** Highest single-month guest count across every hotel — a shared scale for per-hotel charts. */
	maxHotelMonth: number;
};

const avg = (nights: number, stays: number) => (stays > 0 ? Math.round((nights / stays) * 10) / 10 : null);

export function buildVisitorReport(
	hotels: { id: string; name: string; slug: string }[],
	rows: VisitorRow[],
	months: string[]
): VisitorReport {
	const blank = () => new Map(months.map((m) => [m, 0]));
	const byHotel = new Map(
		hotels.map((h) => [
			h.id,
			{ ...h, guests: 0, stays: 0, nights: 0, guestNights: 0, tourists: 0, touristStays: 0, perMonth: blank() }
		])
	);
	const all = blank();
	const allTourists = blank();

	for (const r of rows) {
		const h = byHotel.get(r.hotelId);
		if (!h || !h.perMonth.has(r.month)) continue;
		h.guests += r.guests;
		h.stays += r.stays;
		h.nights += r.nights;
		h.guestNights += r.guestNights;
		h.tourists += r.tourists;
		h.touristStays += r.touristStays;
		allTourists.set(r.month, allTourists.get(r.month)! + r.tourists);
		h.perMonth.set(r.month, h.perMonth.get(r.month)! + r.guests);
		all.set(r.month, all.get(r.month)! + r.guests);
	}

	const list: HotelVisitors[] = [...byHotel.values()]
		.map((h) => ({
			id: h.id,
			name: h.name,
			slug: h.slug,
			guests: h.guests,
			stays: h.stays,
			guestNights: h.guestNights,
			nights: h.nights,
			tourists: h.tourists,
			touristStays: h.touristStays,
			avgNights: avg(h.nights, h.stays),
			monthly: months.map((month) => ({ month, guests: h.perMonth.get(month) ?? 0 }))
		}))
		.sort((a, b) => b.guests - a.guests || a.name.localeCompare(b.name));

	const totals = list.reduce(
		(t, h) => ({
			guests: t.guests + h.guests,
			stays: t.stays + h.stays,
			nights: t.nights + h.nights,
			guestNights: t.guestNights + h.guestNights,
			tourists: t.tourists + h.tourists,
			touristStays: t.touristStays + h.touristStays
		}),
		{ guests: 0, stays: 0, nights: 0, guestNights: 0, tourists: 0, touristStays: 0 }
	);

	return {
		months: months.map((month) => ({ month, guests: all.get(month) ?? 0 })),
		touristMonths: months.map((month) => ({ month, tourists: allTourists.get(month) ?? 0 })),
		hotels: list,
		// Length of stay is per stay (a booking): nights of the stays ÷ number of stays.
		totals: { ...totals, avgNights: avg(totals.nights, totals.stays) },
		reporting: list.filter((h) => h.guests > 0).length,
		maxHotelMonth: list.reduce((m, h) => h.monthly.reduce((mm, x) => Math.max(mm, x.guests), m), 0)
	};
}

export function visitorsCsvRows(report: VisitorReport): { headers: string[]; rows: (string | number)[][] } {
	return {
		headers: [
			'Hotel',
			'Slug',
			'Guests',
			'Stays',
			'Guest-nights',
			'Average nights per stay',
			'Tourists recorded',
			'Stays with a tourist count'
		],
		rows: [
			...report.hotels.map((h) => [h.name, h.slug, h.guests, h.stays, h.guestNights, h.avgNights ?? '', h.tourists, h.touristStays]),
			['All hotels', '', report.totals.guests, report.totals.stays, report.totals.guestNights, report.totals.avgNights ?? '', report.totals.tourists, report.totals.touristStays]
		]
	};
}
