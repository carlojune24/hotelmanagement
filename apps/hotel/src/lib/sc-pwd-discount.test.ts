import { describe, expect, it } from 'vitest';
import { computeScPwdDiscount, computeScPwdShare, roomChargeOptions } from './sc-pwd-discount';

describe('computeScPwdDiscount', () => {
	it('20% on a VAT-inclusive ₱2,240 room charge (₱2,000 net + ₱240 VAT)', () => {
		const r = computeScPwdDiscount({
			subtotalCentavos: 200_000,
			feesCentavos: 0,
			vatCentavos: 24_000,
			discountBps: 2000
		});
		expect(r).toEqual({
			baseAmountCentavos: 200_000,
			vatRemovedCentavos: 24_000,
			discountCentavos: 40_000,
			totalReductionCentavos: 64_000
		});
	});

	it('fees are part of the discountable base', () => {
		const r = computeScPwdDiscount({
			subtotalCentavos: 200_000,
			feesCentavos: 50_000,
			vatCentavos: 30_000,
			discountBps: 2000
		});
		expect(r.baseAmountCentavos).toBe(250_000);
		expect(r.discountCentavos).toBe(50_000);
		expect(r.totalReductionCentavos).toBe(80_000);
	});

	it('0% configured is a no-op reduction beyond VAT removal', () => {
		const r = computeScPwdDiscount({
			subtotalCentavos: 200_000,
			feesCentavos: 0,
			vatCentavos: 24_000,
			discountBps: 0
		});
		expect(r.discountCentavos).toBe(0);
		expect(r.totalReductionCentavos).toBe(24_000);
	});

	it('a non-VAT hotel (vatCentavos = 0) only reduces by the discount', () => {
		const r = computeScPwdDiscount({
			subtotalCentavos: 100_000,
			feesCentavos: 0,
			vatCentavos: 0,
			discountBps: 2000
		});
		expect(r.vatRemovedCentavos).toBe(0);
		expect(r.discountCentavos).toBe(20_000);
		expect(r.totalReductionCentavos).toBe(20_000);
	});

	it('rounds the discount to the nearest centavo', () => {
		const r = computeScPwdDiscount({
			subtotalCentavos: 33_333,
			feesCentavos: 0,
			vatCentavos: 4_000,
			discountBps: 2000
		});
		expect(r.discountCentavos).toBe(Math.round((33_333 * 2000) / 10000));
	});
});

describe('computeScPwdShare', () => {
	const room = { key: 'room', label: 'Room nights', amountCentavos: 336_000, vatCentavos: 36_000, perHead: true };

	it('BIR sample: ₱3,360 room, 1 of 3 guests is SC/PWD → guest pays ₱3,040', () => {
		const r = computeScPwdShare({ lines: [room], claimants: 1, guests: 3, discountBps: 2000 });
		expect(r.shareCentavos).toBe(112_000);
		expect(r.vatRemovedCentavos).toBe(12_000);
		expect(r.baseAmountCentavos).toBe(100_000);
		expect(r.discountCentavos).toBe(20_000);
		expect(336_000 - r.totalReductionCentavos).toBe(304_000);
	});

	it("the claimant's own extra bed counts in full, not per head", () => {
		const bed = { key: 'extra_bed', label: 'Extra bed', amountCentavos: 56_000, vatCentavos: 6_000, perHead: false };
		const r = computeScPwdShare({ lines: [room, bed], claimants: 1, guests: 3, discountBps: 2000 });
		expect(r.lines[1]!.shareCentavos).toBe(56_000);
		expect(r.vatRemovedCentavos).toBe(12_000 + 6_000);
		expect(r.discountCentavos).toBe(Math.round(((100_000 + 50_000) * 2000) / 10000));
	});

	it('a non-VAT hotel takes 20% off the share only', () => {
		const r = computeScPwdShare({
			lines: [{ ...room, amountCentavos: 300_000, vatCentavos: 0 }],
			claimants: 1,
			guests: 3,
			discountBps: 2000
		});
		expect(r.vatRemovedCentavos).toBe(0);
		expect(r.discountCentavos).toBe(20_000);
	});

	it('claimants never exceed guests', () => {
		const r = computeScPwdShare({ lines: [room], claimants: 5, guests: 2, discountBps: 2000 });
		expect(r.shareCentavos).toBe(336_000);
	});
});

describe('roomChargeOptions', () => {
	it('splits VAT between room nights and the extra bed in proportion', () => {
		const o = roomChargeOptions({ subtotalCentavos: 300_000, feesCentavos: 50_000, vatCentavos: 42_000, extraBedCentavos: 50_000 });
		expect(o.map((x) => [x.key, x.amountCentavos, x.vatCentavos])).toEqual([
			['room', 336_000, 36_000],
			['extra_bed', 56_000, 6_000]
		]);
	});

	it('offers no extra bed when there is none', () => {
		expect(roomChargeOptions({ subtotalCentavos: 1, feesCentavos: 0, vatCentavos: 0, extraBedCentavos: 0 })).toHaveLength(1);
	});
});
