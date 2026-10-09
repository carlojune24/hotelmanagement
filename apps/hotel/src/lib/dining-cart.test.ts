import { describe, expect, it } from 'vitest';
import {
	MAX_QUANTITY,
	addLine,
	addonSignature,
	cartTotals,
	changeQuantity,
	findPlainLine,
	quantityOf,
	removeLine,
	restoreLines,
	setRemarks,
	toStored,
	type CartLine
} from './dining-cart';

const adobo = { id: 'adobo', name: 'Adobo', priceCentavos: 8_000 };
const soup = { id: 'soup', name: 'Layua sa baboy', priceCentavos: 15_000 };
const rice = { id: 'rice', name: 'Garlic rice', priceCentavos: 1_500 };
const egg = { id: 'egg', name: 'Egg', priceCentavos: 2_000 };

describe('addLine', () => {
	it('merges an identical dish into one line', () => {
		let lines: CartLine[] = [];
		lines = addLine(lines, adobo, [], 1, '', 1);
		lines = addLine(lines, adobo, [], 2, '', 2);
		expect(lines).toHaveLength(1);
		expect(lines[0]!.quantity).toBe(3);
	});
	it('keeps the same dish with different add-ons or a different note as separate lines', () => {
		let lines: CartLine[] = [];
		lines = addLine(lines, adobo, [], 1, '', 1);
		lines = addLine(lines, adobo, [rice], 1, '', 2);
		lines = addLine(lines, adobo, [], 1, 'no onions', 3);
		expect(lines).toHaveLength(3);
	});
	it('treats add-on order as irrelevant', () => {
		let lines: CartLine[] = [];
		lines = addLine(lines, adobo, [rice, egg], 1, '', 1);
		lines = addLine(lines, adobo, [egg, rice], 1, '', 2);
		expect(lines).toHaveLength(1);
		expect(addonSignature([rice, egg])).toBe(addonSignature([egg, rice]));
	});
	it('stops at 50 and never goes below 1', () => {
		let lines = addLine([], adobo, [], 49, '', 1);
		lines = addLine(lines, adobo, [], 10, '', 2);
		expect(lines[0]!.quantity).toBe(MAX_QUANTITY);
		expect(addLine([], adobo, [], 0, '', 1)[0]!.quantity).toBe(1);
		expect(addLine([], adobo, [], 999, '', 1)[0]!.quantity).toBe(MAX_QUANTITY);
	});
	it('does not change the lines it was given', () => {
		const lines = addLine([], adobo, [], 1, '', 1);
		const after = addLine(lines, adobo, [], 1, '', 2);
		expect(lines[0]!.quantity).toBe(1);
		expect(after[0]!.quantity).toBe(2);
	});
});

describe('changeQuantity and removeLine', () => {
	const base = () => addLine(addLine([], adobo, [], 2, '', 1), soup, [], 1, '', 2);
	it('moves a line up and down and removes it at zero', () => {
		expect(changeQuantity(base(), 1, +1).find((l) => l.key === 1)!.quantity).toBe(3);
		expect(changeQuantity(base(), 1, -1).find((l) => l.key === 1)!.quantity).toBe(1);
		expect(changeQuantity(changeQuantity(base(), 1, -1), 1, -1).map((l) => l.key)).toEqual([2]);
	});
	it('caps at 50', () => {
		const lines = addLine([], adobo, [], MAX_QUANTITY, '', 1);
		expect(changeQuantity(lines, 1, +1)[0]!.quantity).toBe(MAX_QUANTITY);
	});
	it('removes one line and leaves the rest', () => {
		expect(removeLine(base(), 2).map((l) => l.item.id)).toEqual(['adobo']);
	});
	it('ignores a key that is not there', () => {
		expect(changeQuantity(base(), 99, 1)).toEqual(base());
	});
});

describe('the dish photo', () => {
	it('goes into the cart with the dish and comes back from today\'s menu', () => {
		const withPhoto = { ...adobo, imageUrl: '/u/adobo.webp' };
		const lines = addLine([], withPhoto, [], 1, '', 1);
		expect(lines[0]!.item.imageUrl).toBe('/u/adobo.webp');
		expect(addLine([], adobo, [], 1, '', 1)[0]!.item.imageUrl).toBeNull();
		const menu = {
			items: [{ id: 'adobo', name: 'Adobo', priceCentavos: 8_000, imageUrl: '/u/new.webp', isAvailable: true, addonGroupIds: [] }],
			groups: []
		};
		expect(restoreLines(toStored(lines), menu)[0]!.item.imageUrl).toBe('/u/new.webp');
	});
});

describe('setRemarks', () => {
	it('changes one line\'s note and nothing else', () => {
		const lines = addLine(addLine([], adobo, [], 1, '', 1), soup, [], 1, '', 2);
		const next = setRemarks(lines, 2, 'extra spicy');
		expect(next.map((l) => l.remarks)).toEqual(['', 'extra spicy']);
		expect(lines[1]!.remarks).toBe('');
		expect(setRemarks(lines, 1, 'x'.repeat(400))[0]!.remarks).toHaveLength(300);
	});
});

describe('findPlainLine and quantityOf', () => {
	it('finds only the plain version of a dish, and counts every variant', () => {
		let lines = addLine([], adobo, [rice], 2, '', 1);
		expect(findPlainLine(lines, 'adobo')).toBeUndefined();
		lines = addLine(lines, adobo, [], 1, '', 2);
		expect(findPlainLine(lines, 'adobo')!.key).toBe(2);
		expect(quantityOf(lines, 'adobo')).toBe(3);
		expect(quantityOf(lines, 'soup')).toBe(0);
	});
});

describe('cartTotals', () => {
	it('prices dish plus add-ons times quantity and counts items', () => {
		let lines = addLine([], adobo, [rice], 2, '', 1); // (80 + 15) x 2 = 190
		lines = addLine(lines, soup, [], 1, '', 2); // 150
		const t = cartTotals(lines);
		expect(t.totalCentavos).toBe(34_000);
		expect(t.itemCount).toBe(3);
		expect(t.priced.map((p) => p.lineTotalCentavos)).toEqual([19_000, 15_000]);
	});
	it('is empty and zero for an empty cart', () => {
		expect(cartTotals([])).toEqual({ priced: [], itemCount: 0, totalCentavos: 0 });
	});
});

describe('restoring a cart after a reload', () => {
	const menu = {
		items: [
			{ id: 'adobo', name: 'Adobo', priceCentavos: 9_000, isAvailable: true, addonGroupIds: ['g1'] }, // price changed since
			{ id: 'soup', name: 'Layua sa baboy', priceCentavos: 15_000, isAvailable: false, addonGroupIds: [] }
		],
		groups: [{ id: 'g1', addons: [{ id: 'rice', name: 'Garlic rice', priceCentavos: 1_500, isAvailable: true }, { id: 'egg', name: 'Egg', priceCentavos: 2_000, isAvailable: false }] }]
	};
	it('uses today\'s prices and names, not the stored ones', () => {
		const stored = toStored(addLine([], adobo, [rice], 2, 'no onions', 1));
		const lines = restoreLines(stored, menu);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ item: { id: 'adobo', priceCentavos: 9_000 }, quantity: 2, remarks: 'no onions' });
		expect(lines[0]!.addons.map((a) => a.id)).toEqual(['rice']);
	});
	it('drops a dish that is sold out or gone, and an add-on that is no longer offered', () => {
		const stored = [
			{ itemId: 'soup', addonIds: [], quantity: 1, remarks: '' }, // sold out
			{ itemId: 'ghost', addonIds: [], quantity: 1, remarks: '' }, // not on the menu
			{ itemId: 'adobo', addonIds: ['egg'], quantity: 1, remarks: '' }, // egg unavailable
			{ itemId: 'adobo', addonIds: ['nope'], quantity: 1, remarks: '' }, // not an option of this dish
			{ itemId: 'adobo', addonIds: [], quantity: 1, remarks: '' } // fine
		];
		const lines = restoreLines(stored, menu);
		expect(lines.map((l) => l.item.id)).toEqual(['adobo']);
		expect(lines[0]!.addons).toEqual([]);
	});
	it('survives junk without throwing', () => {
		expect(restoreLines(null, menu)).toEqual([]);
		expect(restoreLines('x', menu)).toEqual([]);
		expect(restoreLines([null, 3, 'a', { itemId: 'adobo', quantity: 'many', addonIds: 'no' }], menu).map((l) => l.quantity)).toEqual([1]);
	});
	it('clamps stored quantities and keeps unique keys', () => {
		const stored = [
			{ itemId: 'adobo', addonIds: [], quantity: 500, remarks: '' },
			{ itemId: 'adobo', addonIds: ['rice'], quantity: 2, remarks: '' }
		];
		const lines = restoreLines(stored, menu, 10);
		expect(lines.map((l) => l.quantity)).toEqual([MAX_QUANTITY, 2]);
		expect(new Set(lines.map((l) => l.key)).size).toBe(2);
	});
});
