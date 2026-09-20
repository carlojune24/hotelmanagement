import { describe, expect, it } from 'vitest';
import { allocateOrderPayment, computeDownpayment, isPartialDownpayment } from './downpayment';

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

describe('allocateOrderPayment', () => {
	it('pro-rata by line total and sums exactly', () => {
		expect(allocateOrderPayment(500_000, [600_000, 400_000])).toEqual([300_000, 200_000]);
	});
	it('largest remainder keeps the exact total on awkward splits', () => {
		const shares = allocateOrderPayment(100, [1, 1, 1]);
		expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
		expect(shares).toEqual([34, 33, 33]);
	});
	it('a single line takes the whole payment; empty and zero-total are safe', () => {
		expect(allocateOrderPayment(777, [1_000])).toEqual([777]);
		expect(allocateOrderPayment(50, [0, 0])).toEqual([50, 0]);
		expect(allocateOrderPayment(50, [])).toEqual([]);
	});
	it('allocates a refund (negative) mirrored', () => {
		const shares = allocateOrderPayment(-101, [1, 1]);
		expect(shares.reduce((a, b) => a + b, 0)).toBe(-101);
		expect(shares).toEqual([-51, -50]);
	});
});
