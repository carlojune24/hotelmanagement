import { describe, expect, it } from 'vitest';
import {
	availableNights,
	buildOccupancyReport,
	measures,
	monthEnd,
	occupancyCsvRows,
	type SoldRow
} from './occupancy';

describe('availableNights', () => {
	it('is rooms × days from the later of period start and first stay, to the earlier of period end and today', () => {
		expect(availableNights(10, '2026-01-01', '2026-03-01', '2026-03-31', '2026-10-01')).toBe(310);
		// opened mid-period: 10 rooms × (Mar 11..Mar 31 = 21 days)
		expect(availableNights(10, '2026-03-11', '2026-03-01', '2026-03-31', '2026-10-01')).toBe(210);
		// period runs past today: only up to today (Oct 1..Oct 10 = 10 days)
		expect(availableNights(10, '2026-01-01', '2026-10-01', '2026-10-31', '2026-10-10')).toBe(100);
	});
	it('is zero before opening, with no stays, with no rooms, or entirely in the future', () => {
		expect(availableNights(10, '2026-06-01', '2026-03-01', '2026-03-31', '2026-10-01')).toBe(0);
		expect(availableNights(10, undefined, '2026-03-01', '2026-03-31', '2026-10-01')).toBe(0);
		expect(availableNights(0, '2026-01-01', '2026-03-01', '2026-03-31', '2026-10-01')).toBe(0);
		expect(availableNights(10, '2026-01-01', '2026-11-01', '2026-11-30', '2026-10-01')).toBe(0);
	});
});

describe('measures', () => {
	it('computes occupancy, ADR and RevPAR; RevPAR = ADR × occupancy', () => {
		const m = measures(150, 300, 6_000_000); // ₱60,000 over 150 sold of 300 available
		expect(m.occupancyPct).toBe(50);
		expect(m.adrCentavos).toBe(40_000); // ₱400 per sold night
		expect(m.revparCentavos).toBe(20_000); // ₱200 per available night
	});
	it('returns null, not 0 or NaN, when there is nothing to divide by', () => {
		expect(measures(0, 0, 0)).toMatchObject({ occupancyPct: null, adrCentavos: null, revparCentavos: null });
		expect(measures(0, 100, 0)).toMatchObject({ occupancyPct: 0, adrCentavos: null, revparCentavos: 0 });
	});
});

describe('monthEnd', () => {
	it('handles month lengths and leap years', () => {
		expect(monthEnd('2026-02')).toBe('2026-02-28');
		expect(monthEnd('2028-02')).toBe('2028-02-29');
		expect(monthEnd('2026-12')).toBe('2026-12-31');
	});
});

describe('buildOccupancyReport', () => {
	const hotels = [
		{ id: 'a', name: 'Alpha', slug: 'alpha', rooms: 10 },
		{ id: 'b', name: 'Bravo', slug: 'bravo', rooms: 20 },
		{ id: 'c', name: 'Charlie', slug: 'charlie', rooms: 5 }
	];
	const openedOn = new Map([
		['a', '2026-01-01'],
		['b', '2026-09-16'] // opened halfway through September
	]);
	const sold: SoldRow[] = [
		{ hotelId: 'a', month: '2026-08', roomNights: 124, revenueCentavos: 6_200_000 }, // 40% of 310
		{ hotelId: 'a', month: '2026-09', roomNights: 150, revenueCentavos: 7_500_000 }, // 50% of 300
		{ hotelId: 'b', month: '2026-09', roomNights: 150, revenueCentavos: 9_000_000 }, // 150 of 20×15=300
		{ hotelId: 'zzz', month: '2026-09', roomNights: 999, revenueCentavos: 1 }
	];
	const report = buildOccupancyReport({
		hotels,
		openedOn,
		sold,
		range: { from: '2026-08-01', to: '2026-09-30' },
		today: '2026-10-01',
		months: ['2026-08', '2026-09']
	});

	it('computes each hotel against only the nights it could sell', () => {
		const a = report.hotels.find((h) => h.id === 'a')!;
		expect(a).toMatchObject({ roomNightsSold: 274, roomNightsAvailable: 610, openedOn: '2026-01-01' });
		expect(a.occupancyPct).toBe(44.9);
		const b = report.hotels.find((h) => h.id === 'b')!;
		expect(b.roomNightsAvailable).toBe(300); // not 20 × 61
		expect(b.occupancyPct).toBe(50);
	});

	it('shows a hotel with no stays as having nothing to sell, not as 0% occupied', () => {
		const c = report.hotels.find((h) => h.id === 'c')!;
		expect(c).toMatchObject({ roomNightsAvailable: 0, occupancyPct: null, openedOn: null });
		expect(report.reporting).toBe(2);
	});

	it('ranks by occupancy with unmeasurable hotels last and ignores unknown hotels', () => {
		expect(report.hotels.map((h) => h.id)).toEqual(['b', 'a', 'c']);
		expect(report.totals.roomNightsSold).toBe(424);
	});

	it("consolidates months using each month's own available nights", () => {
		const [aug, sep] = report.months;
		expect(aug).toMatchObject({ month: '2026-08', roomNightsSold: 124, roomNightsAvailable: 310, occupancyPct: 40 });
		expect(sep).toMatchObject({ month: '2026-09', roomNightsSold: 300, roomNightsAvailable: 600 });
		expect(sep!.occupancyPct).toBe(50);
		expect(report.totals.roomNightsAvailable).toBe(910);
	});

	it('exports a CSV with an all-hotels row', () => {
		const csv = occupancyCsvRows(report);
		expect(csv.rows[0]![0]).toBe('Bravo');
		expect(csv.rows.at(-1)).toEqual(['All hotels', '', 35, 424, 910, 46.6, '535.38', '249.45', '227000.00']);
	});
});
