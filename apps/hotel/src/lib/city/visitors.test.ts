import { describe, expect, it } from 'vitest';
import { buildVisitorReport, visitorsCsvRows, type VisitorRow } from './visitors';

const hotels = [
	{ id: 'a', name: 'Alpha', slug: 'alpha' },
	{ id: 'b', name: 'Bravo', slug: 'bravo' },
	{ id: 'c', name: 'Charlie', slug: 'charlie' }
];
const months = ['2026-08', '2026-09'];
const rows: VisitorRow[] = [
	{ hotelId: 'a', month: '2026-08', guests: 10, stays: 4, guestNights: 20 },
	{ hotelId: 'a', month: '2026-09', guests: 6, stays: 2, guestNights: 9 },
	{ hotelId: 'b', month: '2026-09', guests: 30, stays: 10, guestNights: 45 },
	{ hotelId: 'zzz', month: '2026-09', guests: 99, stays: 9, guestNights: 99 },
	{ hotelId: 'a', month: '2025-01', guests: 50, stays: 5, guestNights: 50 }
];
const report = buildVisitorReport(hotels, rows, months);

describe('buildVisitorReport', () => {
	it('sums per hotel and consolidates, ignoring unknown hotels and out-of-range months', () => {
		expect(report.hotels.find((h) => h.id === 'a')).toMatchObject({ guests: 16, stays: 6, guestNights: 29 });
		expect(report.totals).toMatchObject({ guests: 46, stays: 16, guestNights: 74 });
	});
	it('ranks by guests and keeps hotels with no visitors', () => {
		expect(report.hotels.map((h) => h.id)).toEqual(['b', 'a', 'c']);
		expect(report.reporting).toBe(2);
		expect(report.hotels[2]!.avgNights).toBeNull();
	});
	it('averages length of stay over stays, not guests', () => {
		expect(report.hotels.find((h) => h.id === 'a')!.avgNights).toBe(4.8); // 29 nights / 6 stays
		expect(report.totals.avgNights).toBe(4.6); // 74 / 16
	});
	it('gives every hotel a full month series and the consolidated series sums them', () => {
		expect(report.hotels.find((h) => h.id === 'c')!.monthly).toEqual([
			{ month: '2026-08', guests: 0 },
			{ month: '2026-09', guests: 0 }
		]);
		expect(report.months).toEqual([
			{ month: '2026-08', guests: 10 },
			{ month: '2026-09', guests: 36 }
		]);
	});
	it('exposes the highest single hotel-month as a shared chart scale', () => {
		expect(report.maxHotelMonth).toBe(30);
	});
	it('exports a CSV with a consolidated row', () => {
		const csv = visitorsCsvRows(report);
		expect(csv.rows[0]).toEqual(['Bravo', 'bravo', 30, 10, 45, 4.5]);
		expect(csv.rows.at(-1)).toEqual(['All hotels', '', 46, 16, 74, 4.6]);
	});
});
