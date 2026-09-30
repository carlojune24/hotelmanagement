import { describe, expect, it } from 'vitest';
import { computePromoDiscountCentavos, normalizePromoCode } from './promo-codes';

describe('normalizePromoCode', () => {
	it('trims and uppercases', () => {
		expect(normalizePromoCode('  welcome10  ')).toBe('WELCOME10');
	});
	it('caps at the max length', () => {
		expect(normalizePromoCode('a'.repeat(50))).toBe('A'.repeat(40));
	});
	it('an empty/blank code normalizes to an empty string', () => {
		expect(normalizePromoCode('   ')).toBe('');
	});
});

describe('computePromoDiscountCentavos', () => {
	const pct = (bps: number) => ({
		discountType: 'percentage' as const,
		discountBps: bps,
		discountAmountCentavos: null
	});
	const fixed = (centavos: number) => ({
		discountType: 'fixed_amount' as const,
		discountBps: null,
		discountAmountCentavos: centavos
	});

	it('takes the percentage of what is eligible, rounded to a whole centavo', () => {
		expect(computePromoDiscountCentavos(pct(1000), 3_696_000)).toBe(369_600);
		expect(computePromoDiscountCentavos(pct(333), 1_000)).toBe(33);
	});
	it('takes a flat amount, never more than what is eligible', () => {
		expect(computePromoDiscountCentavos(fixed(50_000), 200_000)).toBe(50_000);
		expect(computePromoDiscountCentavos(fixed(500_000), 200_000)).toBe(200_000);
	});
	it('is 0 when nothing is eligible or the code has no value', () => {
		expect(computePromoDiscountCentavos(pct(1000), 0)).toBe(0);
		expect(computePromoDiscountCentavos(fixed(0), 100_000)).toBe(0);
		expect(computePromoDiscountCentavos({ discountType: 'percentage', discountBps: null, discountAmountCentavos: null }, 100_000)).toBe(0);
	});
	it('a 100% code covers the whole amount — checkout refuses it rather than charge zero', () => {
		// The admin form caps percentages at 90%, but a flat amount can still equal the total;
		// this is the case `details/+page.server.ts` guards with `total - discount <= 0`.
		expect(computePromoDiscountCentavos(pct(10_000), 112_000)).toBe(112_000);
		expect(computePromoDiscountCentavos(fixed(999_999_999), 112_000)).toBe(112_000);
	});
});
