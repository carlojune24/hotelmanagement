import { describe, expect, it } from 'vitest';
import { computeScPwdDiscount } from './sc-pwd-discount';

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
