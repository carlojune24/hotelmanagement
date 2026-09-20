import { describe, expect, it } from 'vitest';
import { cancellationRefundCentavos, lineChargesCentavos, orderLedgerTotals } from './ledger';

const room = (folio: number | null, total: number, status = 'confirmed') => ({
	folioChargesCentavos: folio,
	totalCentavos: total,
	status
});

describe('orderLedgerTotals', () => {
	it('the reported case: 3 rooms 15,008 total, 5,008 paid → 10,000 owed, once', () => {
		const t = orderLedgerTotals(
			[room(500_000, 500_000), room(500_000, 500_000), room(500_800, 500_800)],
			500_800
		);
		expect(t.chargesTotalCentavos).toBe(1_500_800);
		expect(t.balanceCentavos).toBe(1_000_000);
	});
	it('a line with no folio yet counts its total when live', () => {
		const t = orderLedgerTotals([room(null, 100_000), room(null, 100_000)], 50_000);
		expect(t.balanceCentavos).toBe(150_000);
	});
	it('pending and cancelled lines without a folio owe nothing', () => {
		expect(lineChargesCentavos(room(null, 100_000, 'pending_payment'))).toBe(0);
		expect(lineChargesCentavos(room(null, 100_000, 'cancelled'))).toBe(0);
	});
	it("a folio's own charges win over the booking total (extras, cancellation credit)", () => {
		expect(lineChargesCentavos(room(130_000, 100_000))).toBe(130_000);
		expect(lineChargesCentavos(room(20_000, 100_000, 'cancelled'))).toBe(20_000);
	});
	it('overpayment is a credit (negative balance)', () => {
		expect(orderLedgerTotals([room(100_000, 100_000)], 130_000).balanceCentavos).toBe(-30_000);
	});
});

describe('cancellationRefundCentavos', () => {
	const C = 1_500_800;
	it('5,008 paid of 15,008, cancel a 5,000 room free → no refund, the shortfall stays owed', () => {
		expect(
			cancellationRefundCentavos({
				orderChargesCentavos: C,
				orderPaidCentavos: 500_800,
				lineChargesCentavos: 500_000,
				feeCentavos: 0
			})
		).toBe(0);
	});
	it('fully paid, cancel a 5,000 room free → refund 5,000', () => {
		expect(
			cancellationRefundCentavos({
				orderChargesCentavos: C,
				orderPaidCentavos: C,
				lineChargesCentavos: 500_000,
				feeCentavos: 0
			})
		).toBe(500_000);
	});
	it('fully paid, cancel with a 1,000 fee → refund 4,000', () => {
		expect(
			cancellationRefundCentavos({
				orderChargesCentavos: C,
				orderPaidCentavos: C,
				lineChargesCentavos: 500_000,
				feeCentavos: 100_000
			})
		).toBe(400_000);
	});
	it('50% downpayment 7,504, cancel a 5,000 room → refund 0 (balance 2,504)', () => {
		expect(
			cancellationRefundCentavos({
				orderChargesCentavos: C,
				orderPaidCentavos: 750_400,
				lineChargesCentavos: 500_000,
				feeCentavos: 0
			})
		).toBe(0);
	});
	it('a single-room booking behaves as before: paid 10,000, fee 2,000 → refund 8,000', () => {
		expect(
			cancellationRefundCentavos({
				orderChargesCentavos: 1_000_000,
				orderPaidCentavos: 1_000_000,
				lineChargesCentavos: 1_000_000,
				feeCentavos: 200_000
			})
		).toBe(800_000);
	});
});
