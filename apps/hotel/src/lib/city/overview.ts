/**
 * City overview dashboard — pure helpers that combine the individual reports into one view. Every number
 * here comes straight from a report (income, guests, occupancy, ratings, permits, applications); nothing is
 * recomputed, so the overview can never disagree with the page it links to.
 */
import type { IncomeReport } from './income';
import type { OccupancyReport } from './occupancy';
import type { RatingsReport } from './ratings';
import type { VisitorReport } from './visitors';
import type { PermitCounts } from './permits';

export type HotelGlance = {
	id: string;
	name: string;
	guests: number;
	/** Occupancy %, or null when the hotel had nothing to sell. */
	occupancyPct: number | null;
	revenueCentavos: number;
	/** Average rating, or null = not yet rated. */
	rating: number | null;
	reviewCount: number;
};

/** One row per hotel with the headline figure from each report, busiest (by revenue) first. */
export function mergeHotelGlance(reports: {
	income: IncomeReport;
	visitors: VisitorReport;
	occupancy: OccupancyReport;
	ratings: RatingsReport;
}): HotelGlance[] {
	const guests = new Map(reports.visitors.hotels.map((h) => [h.id, h.guests]));
	const occ = new Map(reports.occupancy.hotels.map((h) => [h.id, h.occupancyPct]));
	const rating = new Map(reports.ratings.hotels.map((h) => [h.id, { avg: h.avg, count: h.count }]));

	return reports.income.hotels
		.map<HotelGlance>((h) => ({
			id: h.id,
			name: h.name,
			guests: guests.get(h.id) ?? 0,
			occupancyPct: occ.get(h.id) ?? null,
			revenueCentavos: h.total,
			rating: rating.get(h.id)?.avg ?? null,
			reviewCount: rating.get(h.id)?.count ?? 0
		}))
		.sort(
			(a, b) =>
				b.revenueCentavos - a.revenueCentavos || b.guests - a.guests || a.name.localeCompare(b.name)
		);
}

export type AttentionItem = {
	key: string;
	label: string;
	count: number;
	href: string;
	/** `warn` = something is overdue or lapsed; `todo` = waiting on the city; `info` = for awareness. */
	tone: 'warn' | 'todo' | 'info';
};

/** What needs the city's attention right now. Only items with a count above zero are returned. */
export function buildAttention(input: {
	pendingApplications: number;
	approvedApplications: number;
	permits: PermitCounts;
	reviewsAwaitingApproval: number;
}): AttentionItem[] {
	const items: AttentionItem[] = [
		{ key: 'permits-expired', label: 'Permits expired', count: input.permits.expired, href: '/city/permits?status=expired', tone: 'warn' },
		{ key: 'permits-expiring', label: 'Permits expiring soon', count: input.permits.expiring, href: '/city/permits?status=expiring', tone: 'warn' },
		{ key: 'apps-pending', label: 'Applications waiting for review', count: input.pendingApplications, href: '/city/applications?status=pending', tone: 'todo' },
		{ key: 'apps-approved', label: 'Approved applications to finalize', count: input.approvedApplications, href: '/city/applications?status=approved', tone: 'todo' },
		{ key: 'permits-none', label: 'Hotels with no permit on file', count: input.permits.none, href: '/city/permits?status=none', tone: 'todo' },
		{ key: 'reviews-pending', label: 'Guest reviews awaiting hotel approval', count: input.reviewsAwaitingApproval, href: '/city/reports/ratings', tone: 'info' }
	];
	return items.filter((i) => i.count > 0);
}
