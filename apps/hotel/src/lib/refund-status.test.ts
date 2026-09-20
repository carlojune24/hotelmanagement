import { describe, expect, it } from 'vitest';
import { summariseRefund } from './refund-status';

const row = (amount: number, status: 'paid' | 'pending' | 'failed') => ({
	amountCentavos: -amount,
	status,
	method: 'paymongo'
});

describe('summariseRefund', () => {
	it('no refund rows and the room is settled → nothing to return', () => {
		expect(summariseRefund([], 0).state).toBe('none');
	});
	it('a paid refund is refunded, with the amount', () => {
		const s = summariseRefund([row(500_000, 'paid')], 0);
		expect(s).toMatchObject({ state: 'refunded', refundedCentavos: 500_000 });
	});
	it('a QR Ph refund waiting on the guest is pending', () => {
		expect(summariseRefund([row(500_000, 'pending')], 0).state).toBe('pending');
	});
	it('only a failed attempt is failed; a later success wins', () => {
		expect(summariseRefund([row(500_000, 'failed')], -500_000).state).toBe('failed');
		expect(summariseRefund([row(500_000, 'failed'), row(500_000, 'paid')], 0).state).toBe('refunded');
	});
	it('a room still in credit with no refund yet is owed', () => {
		expect(summariseRefund([], -300_000)).toMatchObject({ state: 'owed', owedCentavos: 300_000 });
	});
});
