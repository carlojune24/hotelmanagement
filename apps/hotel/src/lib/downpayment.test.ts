import { describe, expect, it } from 'vitest';
import { computeDownpayment, isPartialDownpayment } from './downpayment';

describe('isPartialDownpayment', () => {
	it('only 1..9999 bps is partial', () => {
		expect(isPartialDownpayment(5000)).toBe(true);
		expect(isPartialDownpayment(null)).toBe(false);
		expect(isPartialDownpayment(10000)).toBe(false);
		expect(isPartialDownpayment(0)).toBe(false);
	});
});

describe('computeDownpayment', () => {
	it('50% of one line', () => {
		expect(computeDownpayment([{ totalCentavos: 1_000_000, downpaymentBps: 5000 }])).toEqual({
			dueNowCentavos: 500_000,
			dueAtHotelCentavos: 500_000
		});
	});
	it('null, 10000 and 0 all mean pay in full', () => {
		for (const bps of [null, 10000, 0]) {
			expect(computeDownpayment([{ totalCentavos: 123_456, downpaymentBps: bps }])).toEqual({
				dueNowCentavos: 123_456,
				dueAtHotelCentavos: 0
			});
		}
	});
	it('rounds each line to a whole centavo, then sums', () => {
		// 333_33 * 50% = 16666.5 -> 16667 (Math.round), twice
		const r = computeDownpayment([
			{ totalCentavos: 33_333, downpaymentBps: 5000 },
			{ totalCentavos: 33_333, downpaymentBps: 5000 }
		]);
		expect(r.dueNowCentavos).toBe(33_334);
		expect(r.dueNowCentavos + r.dueAtHotelCentavos).toBe(66_666);
	});
	it('mixes policies and a hall (no policy) in one order', () => {
		const r = computeDownpayment([
			{ totalCentavos: 1_000_000, downpaymentBps: 5000 },
			{ totalCentavos: 400_000, downpaymentBps: 3000 },
			{ totalCentavos: 200_000, downpaymentBps: null }
		]);
		expect(r).toEqual({ dueNowCentavos: 500_000 + 120_000 + 200_000, dueAtHotelCentavos: 780_000 });
	});
	it('empty order', () => {
		expect(computeDownpayment([])).toEqual({ dueNowCentavos: 0, dueAtHotelCentavos: 0 });
	});
});
