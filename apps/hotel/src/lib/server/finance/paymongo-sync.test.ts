import { describe, expect, it } from 'vitest';
import { mapPayout } from './paymongo-sync';

describe('mapPayout', () => {
	it('keeps only the last 4 digits and no holder name, at any depth', () => {
		const row = mapPayout(
			{
				id: 'po_1',
				status: 'deposited',
				amount: 176960,
				fee: 2655,
				net_amount: 173433,
				created_at: 1793147238,
				bank_account_number: '320914455107',
				bank_account_name: 'HOLDER',
				last_payout_transfer: {
					reference_number: 'REF1',
					receiver_account_name: 'HOLDER',
					receiver_account_number: '320914455107'
				},
				organization: { bank_account_name: 'HOLDER', bank_account_number: '320914455107' }
			},
			'hotel-1'
		);

		expect(row.accountLast4).toBe('5107');
		expect(row.reference).toBe('REF1');
		const raw = JSON.stringify(row.raw);
		expect(raw).not.toContain('320914455107');
		expect(raw).not.toContain('HOLDER');
		expect(raw).toContain('REF1');
		expect(raw).toContain('"bank_account_last4":"5107"');
	});
});
