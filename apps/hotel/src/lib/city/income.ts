/**
 * City income report — pure range handling and shaping. Revenue is CASH-BASIS and uses exactly the
 * hotel Finance module's own definition (`revenueBySourceReport`): non-voided cash movements, direction
 * `in`, categories room/hall/incidental/other revenue **and deposits**, by business date. Refunds
 * (direction `out`, category `refund`) are shown separately, never netted, so a hotel's own report and this
 * one reconcile line for line. DB access lives in `lib/server/city/income.ts`.
 */

export const REVENUE_CATEGORIES = [
	'room_revenue',
	'hall_revenue',
	'incidental_sale',
	'other_revenue',
	'deposit'
] as const;

export type IncomeBucket = 'rooms' | 'halls' | 'other' | 'deposits';

const BUCKET_OF: Record<(typeof REVENUE_CATEGORIES)[number], IncomeBucket> = {
	room_revenue: 'rooms',
	hall_revenue: 'halls',
	incidental_sale: 'other',
	other_revenue: 'other',
	deposit: 'deposits'
};

export const BUCKET_LABEL: Record<IncomeBucket, string> = {
	rooms: 'Rooms',
	halls: 'Function halls',
	other: 'Other sales',
	deposits: 'Deposits'
};

/** One grouped cash-movement row: a hotel, a `YYYY-MM` month, a category, a direction. */
export type IncomeRow = {
	hotelId: string;
	month: string;
	category: string;
	direction: 'in' | 'out';
	centavos: number;
};

export type HotelIncome = {
	id: string;
	name: string;
	slug: string;
	rooms: number;
	halls: number;
	other: number;
	deposits: number;
	/** Sum of the four revenue buckets (matches the hotel's own "Revenue by source" total). */
	total: number;
	refunds: number;
};

export type IncomeReport = {
	months: { month: string; revenueCentavos: number }[];
	hotels: HotelIncome[];
	totals: Omit<HotelIncome, 'id' | 'name' | 'slug'>;
	/** Hotels with any revenue in the range. */
	reporting: number;
};

// Date ranges live in ./range (shared with the guests report); re-exported so existing imports keep working.
export * from './range';

// ---------------------------------------------------------------------------
// Shaping

export function buildIncomeReport(
	hotels: { id: string; name: string; slug: string }[],
	rows: IncomeRow[],
	months: string[]
): IncomeReport {
	const byHotel = new Map<string, HotelIncome>(
		hotels.map((h) => [h.id, { ...h, rooms: 0, halls: 0, other: 0, deposits: 0, total: 0, refunds: 0 }])
	);
	const byMonth = new Map<string, number>(months.map((m) => [m, 0]));

	for (const r of rows) {
		const h = byHotel.get(r.hotelId);
		if (!h) continue;
		if (r.direction === 'out') {
			if (r.category === 'refund') h.refunds += r.centavos;
			continue;
		}
		const bucket = BUCKET_OF[r.category as keyof typeof BUCKET_OF];
		if (!bucket) continue;
		h[bucket] += r.centavos;
		h.total += r.centavos;
		if (byMonth.has(r.month)) byMonth.set(r.month, byMonth.get(r.month)! + r.centavos);
	}

	const list = [...byHotel.values()].sort(
		(a, b) => b.total - a.total || a.name.localeCompare(b.name)
	);
	const totals = list.reduce(
		(t, h) => ({
			rooms: t.rooms + h.rooms,
			halls: t.halls + h.halls,
			other: t.other + h.other,
			deposits: t.deposits + h.deposits,
			total: t.total + h.total,
			refunds: t.refunds + h.refunds
		}),
		{ rooms: 0, halls: 0, other: 0, deposits: 0, total: 0, refunds: 0 }
	);

	return {
		months: months.map((month) => ({ month, revenueCentavos: byMonth.get(month) ?? 0 })),
		hotels: list,
		totals,
		reporting: list.filter((h) => h.total > 0).length
	};
}

export function incomeCsvRows(report: IncomeReport): { headers: string[]; rows: (string | number)[][] } {
	const pesos = (c: number) => (c / 100).toFixed(2);
	return {
		headers: ['Hotel', 'Slug', 'Rooms', 'Function halls', 'Other sales', 'Deposits', 'Total revenue', 'Refunds'],
		rows: [
			...report.hotels.map((h) => [
				h.name,
				h.slug,
				pesos(h.rooms),
				pesos(h.halls),
				pesos(h.other),
				pesos(h.deposits),
				pesos(h.total),
				pesos(h.refunds)
			]),
			[
				'All hotels',
				'',
				pesos(report.totals.rooms),
				pesos(report.totals.halls),
				pesos(report.totals.other),
				pesos(report.totals.deposits),
				pesos(report.totals.total),
				pesos(report.totals.refunds)
			]
		]
	};
}

// ---------------------------------------------------------------------------
// Presentation helpers

export function monthLabel(month: string): string {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Intl.DateTimeFormat('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
		new Date(Date.UTC(y, m - 1, 1))
	);
}

export const formatPeso = (centavos: number) =>
	`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Smallest "clean" axis maximum (1, 2, 5 × 10ⁿ) at or above `value`; 0 → 1 so an empty chart still has an axis. */
export function niceMax(value: number): number {
	if (value <= 0) return 1;
	const exp = Math.floor(Math.log10(value));
	const base = 10 ** exp;
	for (const step of [1, 2, 5, 10]) if (step * base >= value) return step * base;
	return 10 * base;
}
