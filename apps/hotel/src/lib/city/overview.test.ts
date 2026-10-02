import { describe, expect, it } from 'vitest';
import { buildAttention, mergeHotelGlance } from './overview';
import { buildIncomeReport } from './income';
import { buildOccupancyReport } from './occupancy';
import { buildRatingsReport } from './ratings';
import { buildVisitorReport } from './visitors';

const hotels = [
	{ id: 'a', name: 'Alpha', slug: 'alpha' },
	{ id: 'b', name: 'Bravo', slug: 'bravo' },
	{ id: 'c', name: 'Charlie', slug: 'charlie' }
];
const months = ['2026-09'];

const income = buildIncomeReport(
	hotels,
	[
		{ hotelId: 'a', month: '2026-09', category: 'room_revenue', direction: 'in', centavos: 100_000 },
		{ hotelId: 'b', month: '2026-09', category: 'room_revenue', direction: 'in', centavos: 300_000 }
	],
	months
);
const visitors = buildVisitorReport(
	hotels,
	[
		{ hotelId: 'a', month: '2026-09', guests: 40, stays: 15, nights: 30, guestNights: 60, tourists: 0, touristStays: 0 },
		{ hotelId: 'b', month: '2026-09', guests: 10, stays: 4, nights: 8, guestNights: 12, tourists: 0, touristStays: 0 }
	],
	months
);
const occupancy = buildOccupancyReport({
	hotels: hotels.map((h) => ({ ...h, rooms: 10 })),
	openedOn: new Map([
		['a', '2026-01-01'],
		['b', '2026-01-01']
	]),
	sold: [{ hotelId: 'a', month: '2026-09', roomNights: 150, revenueCentavos: 100_000 }],
	range: { from: '2026-09-01', to: '2026-09-30' },
	today: '2026-10-01',
	months
});
const ratings = buildRatingsReport(hotels, [{ hotelId: 'b', rating: 4, count: 3 }], []);

describe('mergeHotelGlance', () => {
	const rows = mergeHotelGlance({ income, visitors, occupancy, ratings });

	it('has one row per hotel, ranked by revenue', () => {
		expect(rows.map((r) => r.id)).toEqual(['b', 'a', 'c']);
	});

	it('takes each figure from its own report without recomputing', () => {
		const a = rows.find((r) => r.id === 'a')!;
		expect(a).toMatchObject({ guests: 40, occupancyPct: 50, revenueCentavos: 100_000, rating: null, reviewCount: 0 });
		const b = rows.find((r) => r.id === 'b')!;
		expect(b).toMatchObject({ guests: 10, occupancyPct: 0, revenueCentavos: 300_000, rating: 4, reviewCount: 3 });
	});

	it('keeps a hotel with no activity, with nulls rather than zeros for what is unmeasurable', () => {
		const c = rows.find((r) => r.id === 'c')!;
		expect(c).toMatchObject({ guests: 0, revenueCentavos: 0, rating: null });
	});
});

describe('buildAttention', () => {
	const none = { valid: 0, expiring: 0, expired: 0, none: 0 };

	it('returns only items that need attention, warnings first', () => {
		const items = buildAttention({
			pendingApplications: 2,
			approvedApplications: 0,
			permits: { valid: 5, expiring: 1, expired: 3, none: 0 },
			reviewsAwaitingApproval: 7
		});
		expect(items.map((i) => i.key)).toEqual(['permits-expired', 'permits-expiring', 'apps-pending', 'reviews-pending']);
		expect(items[0]).toMatchObject({ count: 3, tone: 'warn', href: '/city/permits?status=expired' });
	});

	it('is empty when nothing is outstanding', () => {
		expect(
			buildAttention({ pendingApplications: 0, approvedApplications: 0, permits: none, reviewsAwaitingApproval: 0 })
		).toEqual([]);
	});

	it('flags hotels with no permit on file', () => {
		const items = buildAttention({
			pendingApplications: 0,
			approvedApplications: 0,
			permits: { ...none, none: 4 },
			reviewsAwaitingApproval: 0
		});
		expect(items).toEqual([
			{ key: 'permits-none', label: 'Hotels with no permit on file', count: 4, href: '/city/permits?status=none', tone: 'todo' }
		]);
	});
});
