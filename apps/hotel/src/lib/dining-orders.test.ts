import { describe, expect, it } from 'vitest';
import { inputVatOf } from './server/finance/calc';
import {
	canMoveOrder,
	checkAddonSelection,
	NEXT_STEP,
	priceLine,
	sumLines,
	vatPortion
} from './dining-orders';

describe('vatPortion', () => {
	it('takes the VAT out of a VAT-inclusive amount (12%: gross × 12 / 112)', () => {
		expect(vatPortion(11_200, 1200)).toBe(1_200);
		expect(vatPortion(25_000, 1200)).toBe(2_679); // 2678.57 rounded
	});
	it('is zero with no VAT rate', () => {
		expect(vatPortion(25_000, 0)).toBe(0);
	});
	it('agrees with the finance module for any amount', () => {
		for (const gross of [1, 99, 12_345, 250_000, 999_999]) {
			expect(vatPortion(gross, 1200)).toBe(inputVatOf(gross, 1200));
		}
	});
});

describe('priceLine / sumLines', () => {
	it('multiplies price plus add-ons by quantity and extracts VAT from the total', () => {
		const l = priceLine({ unitPriceCentavos: 25_000, addonPricesCentavos: [1_500, 0], quantity: 2, taxable: true, vatRateBps: 1200 });
		expect(l.addonsCentavos).toBe(1_500);
		expect(l.lineTotalCentavos).toBe(53_000);
		expect(l.vatCentavos).toBe(vatPortion(53_000, 1200));
	});
	it('charges no VAT on a non-taxable line, and the guest still pays the same price', () => {
		const l = priceLine({ unitPriceCentavos: 10_000, addonPricesCentavos: [], quantity: 3, taxable: false, vatRateBps: 1200 });
		expect(l.lineTotalCentavos).toBe(30_000);
		expect(l.vatCentavos).toBe(0);
	});
	it('totals an order: the total is the sum of lines and never adds VAT on top', () => {
		const a = priceLine({ unitPriceCentavos: 25_000, addonPricesCentavos: [], quantity: 1, taxable: true, vatRateBps: 1200 });
		const b = priceLine({ unitPriceCentavos: 8_000, addonPricesCentavos: [], quantity: 2, taxable: false, vatRateBps: 1200 });
		const t = sumLines([a, b]);
		expect(t.totalCentavos).toBe(41_000);
		expect(t.vatCentavos).toBe(a.vatCentavos);
	});
});

describe('checkAddonSelection', () => {
	const sides = { id: 'g1', name: 'Sides', minChoices: 1, maxChoices: 1 };
	const extras = { id: 'g2', name: 'Extras', minChoices: 0, maxChoices: 2 };
	it('requires a pick for a required group', () => {
		expect(checkAddonSelection('Adobo', [sides], {})).toMatch(/choose an option for "Sides"/);
		expect(checkAddonSelection('Adobo', [sides], { g1: 1 })).toBeNull();
	});
	it('caps picks at the group maximum', () => {
		expect(checkAddonSelection('Adobo', [sides], { g1: 2 })).toMatch(/at most 1/);
		expect(checkAddonSelection('Adobo', [extras], { g2: 3 })).toMatch(/at most 2/);
	});
	it('lets an optional group stay empty', () => {
		expect(checkAddonSelection('Adobo', [extras], {})).toBeNull();
	});
	it('says "at least N" when more than one is required', () => {
		expect(checkAddonSelection('Platter', [{ id: 'g', name: 'Dips', minChoices: 2, maxChoices: null }], { g: 1 })).toMatch(/at least 2/);
	});
});

describe('order status flow', () => {
	it('moves forward through the kitchen and allows skipping "accepted"', () => {
		expect(canMoveOrder('new', 'accepted')).toBe(true);
		expect(canMoveOrder('new', 'preparing')).toBe(true);
		expect(canMoveOrder('preparing', 'ready')).toBe(true);
		expect(canMoveOrder('ready', 'served')).toBe(true);
	});
	it('does not go backwards, skip the kitchen, or reopen a finished order', () => {
		expect(canMoveOrder('ready', 'preparing')).toBe(false);
		expect(canMoveOrder('new', 'served')).toBe(false);
		expect(canMoveOrder('served', 'cancelled')).toBe(false);
		expect(canMoveOrder('cancelled', 'new')).toBe(false);
	});
	it("has one obvious next step for the board's main button", () => {
		expect(NEXT_STEP.new).toBe('preparing');
		expect(NEXT_STEP.preparing).toBe('ready');
		expect(NEXT_STEP.ready).toBe('served');
		expect(NEXT_STEP.served).toBeUndefined();
	});
});
