import { describe, expect, it } from 'vitest';
import { nightsBetween, resolveNightlyRates } from './pricing';

describe('nightsBetween', () => {
	it('returns one date per night, excluding checkout', () => {
		expect(nightsBetween('2026-03-01', '2026-03-04')).toEqual([
			'2026-03-01',
			'2026-03-02',
			'2026-03-03'
		]);
	});

	it('returns a single night for a one-night stay', () => {
		expect(nightsBetween('2026-03-01', '2026-03-02')).toEqual(['2026-03-01']);
	});

	it('returns an empty array when checkOut is not after checkIn', () => {
		expect(nightsBetween('2026-03-01', '2026-03-01')).toEqual([]);
	});

	it('crosses month and year boundaries correctly', () => {
		expect(nightsBetween('2026-12-30', '2027-01-02')).toEqual([
			'2026-12-30',
			'2026-12-31',
			'2027-01-01'
		]);
	});
});

describe('resolveNightlyRates', () => {
	// 2026-03-06 is a Friday, 03-07 a Saturday; default weekend days are [5, 6].
	const base = { basePriceCentavos: 10_000, weekendPriceCentavos: null, weekendDays: [5, 6] };
	const nights = nightsBetween('2026-03-05', '2026-03-09'); // Thu, Fri, Sat, Sun

	it('uses the base price when nothing else applies', () => {
		const out = resolveNightlyRates(nights, base, new Map(), []);
		expect(out.map((n) => n.priceCentavos)).toEqual([10_000, 10_000, 10_000, 10_000]);
	});

	it('applies the weekend price to Fri/Sat nights only', () => {
		const out = resolveNightlyRates(
			nights,
			{ ...base, weekendPriceCentavos: 15_000 },
			new Map(),
			[]
		);
		expect(out.map((n) => n.priceCentavos)).toEqual([10_000, 15_000, 15_000, 10_000]);
	});

	it('lets an exact daily override beat weekend and seasonal pricing', () => {
		const out = resolveNightlyRates(
			nights,
			{ ...base, weekendPriceCentavos: 15_000 },
			new Map([['2026-03-07', 9_000]]),
			[
				{
					startDate: '2026-03-01',
					endDate: '2026-03-31',
					priceCentavos: 20_000,
					multiplierBps: null
				}
			]
		);
		expect(out.map((n) => n.priceCentavos)).toEqual([20_000, 20_000, 9_000, 20_000]);
	});

	it('applies a seasonal multiplier to the baseline (base or weekend) rate', () => {
		const out = resolveNightlyRates(nights, { ...base, weekendPriceCentavos: 15_000 }, new Map(), [
			{ startDate: '2026-03-06', endDate: '2026-03-07', priceCentavos: null, multiplierBps: 13_000 }
		]);
		// Thu/Sun untouched; Fri/Sat = weekend 15_000 × 1.3 = 19_500.
		expect(out.map((n) => n.priceCentavos)).toEqual([10_000, 19_500, 19_500, 10_000]);
	});
});
