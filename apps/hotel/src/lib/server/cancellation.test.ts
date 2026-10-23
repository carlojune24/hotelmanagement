import { describe, expect, it } from 'vitest';
import { computeCancellationFee, type CancellationPolicyView } from './cancellation';

const flexible: CancellationPolicyView = {
	name: 'Flexible',
	freeCancelHours: 48,
	penaltyType: 'first_night',
	penaltyValueBps: null
};
const nonRefundable: CancellationPolicyView = {
	name: 'Non-refundable',
	freeCancelHours: null,
	penaltyType: 'full_amount',
	penaltyValueBps: null
};
const partial: CancellationPolicyView = {
	name: 'Partial',
	freeCancelHours: 24,
	penaltyType: 'percentage_of_total',
	penaltyValueBps: 2500 // 25%
};

// 10% within 24h of payment, then everything is forfeited (the actual hotel policy).
const graceThenForfeit: CancellationPolicyView = {
	name: 'Grace',
	freeCancelHours: null,
	penaltyType: 'full_amount',
	penaltyValueBps: null,
	graceHoursAfterPayment: 24,
	graceFeeBps: 1000
};
const grace = (over: { hoursSincePayment: number | null; hoursUntilCheckIn: number }) =>
	computeCancellationFee({
		policy: graceThenForfeit,
		lineTotalCentavos: 400000,
		paidCentavos: 200000,
		nights: 2,
		...over
	});

describe('computeCancellationFee', () => {
	it('keeps 10% of the total inside the grace period', () => {
		const r = grace({ hoursSincePayment: 5, hoursUntilCheckIn: 100 });
		expect(r.feeCentavos).toBe(40000);
		expect(r.refundCentavos).toBe(160000);
	});

	it('forfeits everything paid once the grace period is over', () => {
		const r = grace({ hoursSincePayment: 25, hoursUntilCheckIn: 100 });
		expect(r.feeCentavos).toBe(200000);
		expect(r.refundCentavos).toBe(0);
	});

	it('ends the grace tier at check-in even if the 24h are not up', () => {
		const r = grace({ hoursSincePayment: 2, hoursUntilCheckIn: -1 });
		expect(r.feeCentavos).toBe(200000);
	});

	it('falls back to the main penalty when nothing has been paid yet', () => {
		const r = grace({ hoursSincePayment: null, hoursUntilCheckIn: 100 });
		expect(r.feeCentavos).toBe(200000);
	});

	it('waives the fee inside the free-cancellation window', () => {
		const r = computeCancellationFee({
			policy: flexible,
			lineTotalCentavos: 400000,
			paidCentavos: 400000,
			nights: 2,
			hoursUntilCheckIn: 72
		});
		expect(r.freeCancellation).toBe(true);
		expect(r.feeCentavos).toBe(0);
		expect(r.refundCentavos).toBe(400000);
	});

	it('charges the first night once the free window has passed', () => {
		const r = computeCancellationFee({
			policy: flexible,
			lineTotalCentavos: 400000,
			paidCentavos: 400000,
			nights: 2,
			hoursUntilCheckIn: 12
		});
		expect(r.freeCancellation).toBe(false);
		expect(r.feeCentavos).toBe(200000);
		expect(r.refundCentavos).toBe(200000);
	});

	it('charges the full total for a non-refundable rate', () => {
		const r = computeCancellationFee({
			policy: nonRefundable,
			lineTotalCentavos: 400000,
			paidCentavos: 400000,
			nights: 3,
			hoursUntilCheckIn: 999
		});
		expect(r.feeCentavos).toBe(400000);
		expect(r.refundCentavos).toBe(0);
	});

	it('applies a percentage penalty', () => {
		const r = computeCancellationFee({
			policy: partial,
			lineTotalCentavos: 400000,
			paidCentavos: 400000,
			nights: 2,
			hoursUntilCheckIn: 1
		});
		expect(r.feeCentavos).toBe(100000);
		expect(r.refundCentavos).toBe(300000);
	});

	it('never charges more than was paid (deposit-only booking)', () => {
		const r = computeCancellationFee({
			policy: nonRefundable,
			lineTotalCentavos: 400000,
			paidCentavos: 150000,
			nights: 2,
			hoursUntilCheckIn: 5
		});
		expect(r.feeCentavos).toBe(150000);
		expect(r.refundCentavos).toBe(0);
	});

	it('defaults to a zero fee (full refund) when no policy is attached', () => {
		const r = computeCancellationFee({
			policy: null,
			lineTotalCentavos: 400000,
			paidCentavos: 400000,
			nights: 2,
			hoursUntilCheckIn: 5
		});
		expect(r.feeCentavos).toBe(0);
		expect(r.refundCentavos).toBe(400000);
		expect(r.basisLabel).toMatch(/no policy/i);
	});

	it('treats the free-window boundary as still free (inclusive)', () => {
		const r = computeCancellationFee({
			policy: flexible,
			lineTotalCentavos: 400000,
			paidCentavos: 400000,
			nights: 2,
			hoursUntilCheckIn: 48
		});
		expect(r.freeCancellation).toBe(true);
	});

	it('reports a zero refund for an unpaid pending line', () => {
		const r = computeCancellationFee({
			policy: flexible,
			lineTotalCentavos: 400000,
			paidCentavos: 0,
			nights: 2,
			hoursUntilCheckIn: 1
		});
		expect(r.feeCentavos).toBe(0);
		expect(r.refundCentavos).toBe(0);
	});
});
