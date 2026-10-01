/**
 * City occupancy & rates report — pure calculation. Everything is stay-night based (accrual), not cash:
 *
 *  - Room-nights sold  = nights of checked-in/checked-out stays that fall inside the period, × rooms booked.
 *  - Room-nights available = a hotel's active rooms × the days it could have sold them: from its first
 *    recorded stay (earlier nights weren't sellable on this platform) to the period end, never past today.
 *  - Occupancy = sold ÷ available.  ADR = room revenue ÷ sold.  RevPAR = room revenue ÷ available.
 *  - Room revenue = each stay's pre-VAT room subtotal spread evenly over its nights (fees/VAT excluded).
 *
 * The room count is today's active rooms, applied to the whole period. DB access: `lib/server/city/occupancy.ts`.
 */

export type SoldRow = {
	hotelId: string;
	/** `YYYY-MM` */
	month: string;
	roomNights: number;
	revenueCentavos: number;
};

export type OccupancyHotel = { id: string; name: string; slug: string; rooms: number };

/** Occupancy ratio as a percentage with 1 decimal, or null when there was nothing to sell. */
const pct = (sold: number, available: number) => (available > 0 ? Math.round((sold / available) * 1000) / 10 : null);
const per = (centavos: number, nights: number) => (nights > 0 ? Math.round(centavos / nights) : null);

export type Measures = {
	roomNightsSold: number;
	roomNightsAvailable: number;
	revenueCentavos: number;
	occupancyPct: number | null;
	adrCentavos: number | null;
	revparCentavos: number | null;
};

export function measures(sold: number, available: number, revenueCentavos: number): Measures {
	return {
		roomNightsSold: sold,
		roomNightsAvailable: available,
		revenueCentavos,
		occupancyPct: pct(sold, available),
		adrCentavos: per(revenueCentavos, sold),
		revparCentavos: per(revenueCentavos, available)
	};
}

// ---------------------------------------------------------------------------
// Dates (`YYYY-MM-DD` strings; UTC arithmetic so there are no DST surprises)

const utc = (s: string) => Date.parse(`${s}T00:00:00Z`);
const days = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86_400_000) + 1;
const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);

export const monthStart = (month: string) => `${month}-01`;
export const monthEnd = (month: string) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * Sellable room-nights for a hotel in [from, to]: rooms × days between its first stay and the period end,
 * capped at today. A hotel with no stays yet (`openedOn` undefined) has none.
 */
export function availableNights(
	rooms: number,
	openedOn: string | undefined,
	from: string,
	to: string,
	today: string
): number {
	if (!openedOn || rooms <= 0) return 0;
	const start = maxDate(from, openedOn);
	const end = minDate(to, today);
	return end < start ? 0 : rooms * days(start, end);
}

// ---------------------------------------------------------------------------
// Report

export type HotelOccupancy = OccupancyHotel & Measures & { openedOn: string | null };
export type MonthOccupancy = Measures & { month: string };

export type OccupancyReport = {
	months: MonthOccupancy[];
	hotels: HotelOccupancy[];
	totals: Measures & { rooms: number };
	/** Hotels with at least one room-night sold in the range. */
	reporting: number;
};

export function buildOccupancyReport(input: {
	hotels: OccupancyHotel[];
	openedOn: Map<string, string>;
	sold: SoldRow[];
	range: { from: string; to: string };
	today: string;
	months: string[];
}): OccupancyReport {
	const { hotels, openedOn, sold, range, today, months } = input;
	const known = new Map(hotels.map((h) => [h.id, h]));

	// Sold nights and revenue per hotel per month.
	const soldBy = new Map<string, { nights: number; revenue: number }>();
	for (const r of sold) {
		if (!known.has(r.hotelId)) continue;
		const k = `${r.hotelId}|${r.month}`;
		const cur = soldBy.get(k) ?? { nights: 0, revenue: 0 };
		soldBy.set(k, { nights: cur.nights + r.roomNights, revenue: cur.revenue + r.revenueCentavos });
	}

	const monthRows: MonthOccupancy[] = [];
	const hotelAcc = new Map(hotels.map((h) => [h.id, { sold: 0, available: 0, revenue: 0 }]));

	for (const month of months) {
		const from = maxDate(range.from, monthStart(month));
		const to = minDate(range.to, monthEnd(month));
		let mSold = 0;
		let mAvail = 0;
		let mRev = 0;
		for (const h of hotels) {
			const s = soldBy.get(`${h.id}|${month}`) ?? { nights: 0, revenue: 0 };
			const a = availableNights(h.rooms, openedOn.get(h.id), from, to, today);
			mSold += s.nights;
			mAvail += a;
			mRev += s.revenue;
			const acc = hotelAcc.get(h.id)!;
			acc.sold += s.nights;
			acc.available += a;
			acc.revenue += s.revenue;
		}
		monthRows.push({ month, ...measures(mSold, mAvail, mRev) });
	}

	const hotelRows: HotelOccupancy[] = hotels
		.map((h) => {
			const a = hotelAcc.get(h.id)!;
			return { ...h, openedOn: openedOn.get(h.id) ?? null, ...measures(a.sold, a.available, a.revenue) };
		})
		// Busiest first; hotels with no sellable nights last.
		.sort(
			(a, b) =>
				(b.occupancyPct ?? -1) - (a.occupancyPct ?? -1) ||
				b.roomNightsSold - a.roomNightsSold ||
				a.name.localeCompare(b.name)
		);

	const tSold = hotelRows.reduce((n, h) => n + h.roomNightsSold, 0);
	const tAvail = hotelRows.reduce((n, h) => n + h.roomNightsAvailable, 0);
	const tRev = hotelRows.reduce((n, h) => n + h.revenueCentavos, 0);

	return {
		months: monthRows,
		hotels: hotelRows,
		totals: { ...measures(tSold, tAvail, tRev), rooms: hotels.reduce((n, h) => n + h.rooms, 0) },
		reporting: hotelRows.filter((h) => h.roomNightsSold > 0).length
	};
}

export function occupancyCsvRows(report: OccupancyReport): { headers: string[]; rows: (string | number)[][] } {
	const pesos = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2));
	const row = (name: string, slug: string, rooms: number, m: Measures) => [
		name,
		slug,
		rooms,
		m.roomNightsSold,
		m.roomNightsAvailable,
		m.occupancyPct ?? '',
		pesos(m.adrCentavos),
		pesos(m.revparCentavos),
		pesos(m.revenueCentavos)
	];
	return {
		headers: ['Hotel', 'Slug', 'Rooms', 'Room-nights sold', 'Room-nights available', 'Occupancy %', 'ADR', 'RevPAR', 'Room revenue'],
		rows: [
			...report.hotels.map((h) => row(h.name, h.slug, h.rooms, h)),
			row('All hotels', '', report.totals.rooms, report.totals)
		]
	};
}
