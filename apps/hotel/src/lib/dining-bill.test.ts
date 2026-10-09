import { describe, expect, it } from 'vitest';
import { buildBill, describeItem, isBillable, type BillOrderInput } from './dining-bill';

function order(over: Partial<BillOrderInput> & { code: string }): BillOrderInput {
	return {
		id: over.code,
		status: 'served',
		paymentStatus: 'unpaid',
		totalCentavos: 0,
		vatCentavos: 0,
		items: [],
		...over
	};
}

const adobo = { name: 'Adobo', quantity: 2, unitPriceCentavos: 15_000, addonsCentavos: 0, lineTotalCentavos: 30_000, addons: [] };
const soda = { name: 'Soda', quantity: 1, unitPriceCentavos: 8_000, addonsCentavos: 2_000, lineTotalCentavos: 10_000, addons: ['large', 'no ice'] };

describe('buildBill', () => {
	it('lists every line with add-ons folded in and the add-on price in the unit price', () => {
		const b = buildBill([order({ code: 'DN-A', items: [adobo, soda], totalCentavos: 40_000, vatCentavos: 4_286 })]);
		expect(b.lines).toEqual([
			{ orderCode: 'DN-A', description: 'Adobo', quantity: 2, unitPriceCentavos: 15_000, lineTotalCentavos: 30_000 },
			{ orderCode: 'DN-A', description: 'Soda (large, no ice)', quantity: 1, unitPriceCentavos: 10_000, lineTotalCentavos: 10_000 }
		]);
		expect(b).toMatchObject({ orderCount: 1, totalCentavos: 40_000, vatCentavos: 4_286, paidCentavos: 0, dueCentavos: 40_000 });
	});

	it('adds up several orders on one table and counts them', () => {
		const b = buildBill([
			order({ code: 'DN-A', items: [adobo], totalCentavos: 30_000, vatCentavos: 3_214 }),
			order({ code: 'DN-B', items: [soda], totalCentavos: 10_000, vatCentavos: 1_071 })
		]);
		expect(b.orderCount).toBe(2);
		expect(b.totalCentavos).toBe(40_000);
		expect(b.vatCentavos).toBe(4_285);
		expect(b.lines.map((l) => l.orderCode)).toEqual(['DN-A', 'DN-B']);
	});

	it('leaves out cancelled, unaccepted and unconfirmed orders', () => {
		const b = buildBill([
			order({ code: 'DN-A', items: [adobo], totalCentavos: 30_000 }),
			order({ code: 'DN-B', status: 'cancelled', items: [soda], totalCentavos: 10_000 }),
			order({ code: 'DN-C', status: 'pending_acceptance', items: [soda], totalCentavos: 10_000 }),
			order({ code: 'DN-D', status: 'pending_payment', items: [soda], totalCentavos: 10_000 })
		]);
		expect(b.lines).toHaveLength(1);
		expect(b.totalCentavos).toBe(30_000);
	});

	it('shows what is already paid and what is still due', () => {
		const b = buildBill([
			order({ code: 'DN-A', items: [adobo], totalCentavos: 30_000, paymentStatus: 'paid' }),
			order({ code: 'DN-B', items: [soda], totalCentavos: 10_000, paymentStatus: 'room_charged' }),
			order({ code: 'DN-C', items: [soda], totalCentavos: 10_000, paymentStatus: 'unpaid' })
		]);
		expect(b.paidCentavos).toBe(40_000);
		expect(b.dueCentavos).toBe(10_000);
	});

	it('is empty and owes nothing when there is nothing to bill', () => {
		expect(buildBill([])).toEqual({ lines: [], orderCount: 0, totalCentavos: 0, vatCentavos: 0, paidCentavos: 0, dueCentavos: 0 });
	});
});

describe('helpers', () => {
	it('describeItem only adds brackets when there are add-ons', () => {
		expect(describeItem('Soda', [])).toBe('Soda');
		expect(describeItem('Soda', ['large'])).toBe('Soda (large)');
	});
	it('isBillable mirrors the Floor check total', () => {
		expect(isBillable({ status: 'served' })).toBe(true);
		expect(isBillable({ status: 'preparing' })).toBe(true);
		expect(isBillable({ status: 'cancelled' })).toBe(false);
		expect(isBillable({ status: 'pending_acceptance' })).toBe(false);
	});
});
