import { describe, expect, it } from 'vitest';
import { MIN_REVIEWS_FOR_RANK, buildRatingsReport, ratingsCsvRows } from './ratings';

const hotels = [
	{ id: 'a', name: 'Alpha', slug: 'alpha' },
	{ id: 'b', name: 'Bravo', slug: 'bravo' },
	{ id: 'c', name: 'Charlie', slug: 'charlie' },
	{ id: 'd', name: 'Delta', slug: 'delta' }
];

const report = buildRatingsReport(
	hotels,
	[
		// Alpha: 10 reviews, mean 4.2 (42 / 10)
		{ hotelId: 'a', rating: 5, count: 4 },
		{ hotelId: 'a', rating: 4, count: 4 },
		{ hotelId: 'a', rating: 3, count: 2 },
		// Bravo: 6 reviews, mean 4.5
		{ hotelId: 'b', rating: 5, count: 3 },
		{ hotelId: 'b', rating: 4, count: 3 },
		// Charlie: 2 reviews, 5.0 — a small sample
		{ hotelId: 'c', rating: 5, count: 2 },
		// unknown hotel and out-of-range rating are ignored
		{ hotelId: 'zzz', rating: 5, count: 99 },
		{ hotelId: 'a', rating: 7, count: 50 }
	],
	[
		{ hotelId: 'a', count: 3, oldest: '2026-09-01' },
		{ hotelId: 'd', count: 1, oldest: '2026-09-20' }
	]
);

describe('buildRatingsReport', () => {
	it('computes per-hotel mean, count and distribution (index 0 = one star)', () => {
		const a = report.hotels.find((h) => h.id === 'a')!;
		expect(a).toMatchObject({ count: 10, avg: 4.2, distribution: [0, 0, 2, 4, 4], pending: 3, oldestPending: '2026-09-01' });
	});

	it('ranks established hotels by rating, then small samples, then unrated', () => {
		// Bravo 4.5 (6) and Alpha 4.2 (10) are established; Charlie 5.0 has only 2 reviews; Delta has none.
		expect(report.hotels.map((h) => h.id)).toEqual(['b', 'a', 'c', 'd']);
		expect(report.hotels.find((h) => h.id === 'c')!.fewReviews).toBe(true);
		expect(MIN_REVIEWS_FOR_RANK).toBe(5);
	});

	it('never shows an unrated hotel as 0', () => {
		const d = report.hotels.find((h) => h.id === 'd')!;
		expect(d.avg).toBeNull();
		expect(d.count).toBe(0);
		expect(d.pending).toBe(1);
	});

	it('weights the overall mean by review and sums the backlog', () => {
		// (42 + 27 + 10) / 18 = 4.388…
		expect(report.totals.count).toBe(18);
		expect(report.totals.avg).toBe(4.4);
		expect(report.totals.distribution).toEqual([0, 0, 2, 7, 9]);
		expect(report.totals.pending).toBe(4);
		expect(report.totals.hotelsRated).toBe(3);
	});

	it('handles no reviews at all', () => {
		const empty = buildRatingsReport(hotels, [], []);
		expect(empty.totals).toMatchObject({ count: 0, avg: null, pending: 0, hotelsRated: 0 });
	});

	it('exports star columns from 5 down to 1 with a totals row', () => {
		const csv = ratingsCsvRows(report);
		expect(csv.rows[0]).toEqual(['Bravo', 'bravo', 4.5, 6, 3, 3, 0, 0, 0, 0]);
		expect(csv.rows.at(-1)).toEqual(['All hotels', '', 4.4, 18, 9, 7, 2, 0, 0, 4]);
	});
});
