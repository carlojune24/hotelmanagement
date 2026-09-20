import { describe, expect, it } from 'vitest';
import { splitInteger, splitRoomLine } from './room-split';

describe('splitInteger', () => {
	it('adds up exactly and differs by at most one', () => {
		expect(splitInteger(100, 3)).toEqual([34, 33, 33]);
		expect(splitInteger(9, 3)).toEqual([3, 3, 3]);
		expect(splitInteger(0, 2)).toEqual([0, 0]);
		expect(splitInteger(5, 0)).toEqual([]);
	});
});

describe('splitRoomLine', () => {
	const price = { subtotalCentavos: 1_000_01, feesCentavos: 50_01, vatCentavos: 126_01, totalCentavos: 1_176_03 };
	it('one room is the line itself', () => {
		expect(splitRoomLine(price, 2, 1, 1)).toEqual([{ ...price, occupancy: 2, extraBeds: 1 }]);
	});
	it('several rooms add up exactly to the line, each with its own guests and at least one', () => {
		const r = splitRoomLine(price, 5, 2, 3);
		expect(r).toHaveLength(3);
		for (const k of ['subtotalCentavos', 'feesCentavos', 'vatCentavos', 'totalCentavos', 'occupancy', 'extraBeds'] as const) {
			const want = k === 'occupancy' ? 5 : k === 'extraBeds' ? 2 : (price as Record<string, number>)[k]!;
			expect(r.reduce((s, x) => s + x[k], 0)).toBe(want);
		}
		expect(r.every((x) => x.occupancy >= 1)).toBe(true);
	});
	it('a party smaller than the room count still puts one guest in every room', () => {
		expect(splitRoomLine(price, 1, 0, 3).map((x) => x.occupancy)).toEqual([1, 1, 1]);
	});
});
