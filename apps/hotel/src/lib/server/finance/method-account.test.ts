import { describe, expect, it } from 'vitest';
import { accountForMethod, DEFAULT_FINANCE_SETTINGS } from './settings';

const settings = {
	...DEFAULT_FINANCE_SETTINGS,
	defaultBankAccountId: 'bank',
	methodAccountIds: { gcash: 'gcash-acct', maya: 'maya-acct' }
};

describe('accountForMethod', () => {
	it('uses the method’s own account when mapped', () => {
		expect(accountForMethod(settings, 'gcash')).toBe('gcash-acct');
		expect(accountForMethod(settings, 'maya')).toBe('maya-acct');
	});
	it('falls back to the default bank / e-wallet for an unmapped method', () => {
		expect(accountForMethod(settings, 'cheque')).toBe('bank');
	});
	it('is null when nothing is mapped and there is no default', () => {
		expect(accountForMethod({ ...settings, defaultBankAccountId: null }, 'card')).toBeNull();
	});
});
