import { describe, expect, it } from 'vitest';
import {
	buildIncomeReport,
	incomeCsvRows,
	monthsBetween,
	niceMax,
	resolveRange,
	type IncomeRow
} from './income';

describe('resolveRange', () => {
	const today = '2026-10-01';
	it('defaults to the last 12 calendar months', () => {
		expect(resolveRange({}, today)).toMatchObject({ preset: 'last-12', from: '2025-11-01', to: today });
	});
	it('resolves presets', () => {
		expect(resolveRange({ range: 'last-month' }, today)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
		expect(resolveRange({ range: 'this-month' }, today)).toMatchObject({ from: '2026-10-01', to: today });
		expect(resolveRange({ range: 'ytd' }, today)).toMatchObject({ from: '2026-01-01', to: today });
		expect(resolveRange({ range: 'last-3' }, today)).toMatchObject({ from: '2026-08-01', to: today });
	});
	it('accepts a valid custom range and rejects bad ones with a fallback', () => {
		expect(resolveRange({ range: 'custom', from: '2026-02-10', to: '2026-03-05' }, today)).toMatchObject({
			preset: 'custom',
			from: '2026-02-10',
			to: '2026-03-05',
			error: null
		});
		expect(resolveRange({ range: 'custom', from: '2026-03-05', to: '2026-02-10' }, today).error).toMatch(/on or before/);
		expect(resolveRange({ range: 'custom', from: '2026-02-30', to: '2026-03-05' }, today).error).toMatch(/valid/);
		expect(resolveRange({ range: 'custom', from: '2000-01-01', to: '2026-01-01' }, today).error).toMatch(/5 years/);
		expect(resolveRange({ range: 'custom', from: 'x', to: 'y' }, today).preset).toBe('last-12');
	});
	it('treats bare from/to as custom and unknown presets as the default', () => {
		expect(resolveRange({ from: '2026-01-01', to: '2026-01-31' }, today).preset).toBe('custom');
		expect(resolveRange({ range: 'bogus' }, today).preset).toBe('last-12');
	});
});

describe('monthsBetween', () => {
	it('lists inclusive months across a year boundary', () => {
		expect(monthsBetween('2025-11-15', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
	});
});

describe('buildIncomeReport', () => {
	const hotels = [
		{ id: 'a', name: 'Alpha', slug: 'alpha' },
		{ id: 'b', name: 'Bravo', slug: 'bravo' },
		{ id: 'c', name: 'Charlie', slug: 'charlie' }
	];
	const months = ['2026-08', '2026-09'];
	const rows: IncomeRow[] = [
		{ hotelId: 'a', month: '2026-08', category: 'room_revenue', direction: 'in', centavos: 100_000 },
		{ hotelId: 'a', month: '2026-09', category: 'incidental_sale', direction: 'in', centavos: 5_000 },
		{ hotelId: 'a', month: '2026-09', category: 'other_revenue', direction: 'in', centavos: 2_500 },
		{ hotelId: 'a', month: '2026-09', category: 'refund', direction: 'out', centavos: 10_000 },
		{ hotelId: 'b', month: '2026-09', category: 'deposit', direction: 'in', centavos: 30_000 },
		{ hotelId: 'b', month: '2026-09', category: 'hall_revenue', direction: 'in', centavos: 50_000 },
		{ hotelId: 'zzz', month: '2026-09', category: 'room_revenue', direction: 'in', centavos: 999 },
		{ hotelId: 'a', month: '2026-09', category: 'expense', direction: 'out', centavos: 77_000 }
	];
	const report = buildIncomeReport(hotels, rows, months);

	it('buckets revenue like the hotel report: deposits included, refunds separate and not netted', () => {
		const a = report.hotels.find((h) => h.id === 'a')!;
		expect(a).toMatchObject({ rooms: 100_000, other: 7_500, total: 107_500, refunds: 10_000 });
		const b = report.hotels.find((h) => h.id === 'b')!;
		expect(b).toMatchObject({ halls: 50_000, deposits: 30_000, total: 80_000 });
	});
	it('ranks by revenue, keeps zero-revenue hotels, ignores unknown hotels and non-revenue movements', () => {
		expect(report.hotels.map((h) => h.id)).toEqual(['a', 'b', 'c']);
		expect(report.reporting).toBe(2);
		expect(report.totals.total).toBe(187_500);
	});
	it('totals by month, including zero months', () => {
		expect(report.months).toEqual([
			{ month: '2026-08', revenueCentavos: 100_000 },
			{ month: '2026-09', revenueCentavos: 87_500 }
		]);
	});
	it('exports a CSV with a totals row in pesos', () => {
		const csv = incomeCsvRows(report);
		expect(csv.rows[0]).toEqual(['Alpha', 'alpha', '1000.00', '0.00', '75.00', '0.00', '1075.00', '100.00']);
		expect(csv.rows.at(-1)![6]).toBe('1875.00');
	});
});

describe('niceMax', () => {
	it('rounds up to 1/2/5 × 10ⁿ', () => {
		expect(niceMax(0)).toBe(1);
		expect(niceMax(730)).toBe(1000);
		expect(niceMax(1000)).toBe(1000);
		expect(niceMax(1001)).toBe(2000);
		expect(niceMax(2600)).toBe(5000);
		expect(niceMax(5200)).toBe(10000);
	});
});
