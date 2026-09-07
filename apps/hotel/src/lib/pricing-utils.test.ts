import { describe, expect, it } from 'vitest';
import { scaleRoomPrice, MAX_ROOMS_PER_LINE } from './pricing-utils';
import type { PriceBreakdown } from '$lib/server/pricing';

const perRoom: PriceBreakdown = {
	nights: [
		{ date: '2026-03-05', priceCentavos: 1_000 },
		{ date: '2026-03-06', priceCentavos: 1_200 }
	],
	subtotalCentavos: 2_200,
	fees: [{ name: 'Resort fee', amountCentavos: 100 }],
	vatCentavos: 264,
	totalCentavos: 2_564
};

describe('scaleRoomPrice', () => {
	it('is a no-op at roomCount 1', () => {
		expect(scaleRoomPrice(perRoom, 1)).toEqual(perRoom);
	});

	it('scales subtotal/fees/vat/total but leaves nights untouched', () => {
		const out = scaleRoomPrice(perRoom, 3);
		expect(out.nights).toEqual(perRoom.nights);
		expect(out.subtotalCentavos).toBe(6_600);
		expect(out.fees).toEqual([{ name: 'Resort fee', amountCentavos: 300 }]);
		expect(out.vatCentavos).toBe(792);
		expect(out.totalCentavos).toBe(7_692);
	});

	it('throws for roomCount below 1', () => {
		expect(() => scaleRoomPrice(perRoom, 0)).toThrow();
		expect(() => scaleRoomPrice(perRoom, -1)).toThrow();
	});
});

describe('MAX_ROOMS_PER_LINE', () => {
	it('is a sane positive bound', () => {
		expect(MAX_ROOMS_PER_LINE).toBeGreaterThan(1);
	});
});
