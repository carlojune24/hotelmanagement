import { describe, expect, it } from 'vitest';
import { addMoney, amountMinor, money, personRef, zeroMoney } from './primitives';

describe('amountMinor', () => {
	it('accepts integer centavos', () => {
		expect(amountMinor.parse(150_00)).toBe(15000);
	});
	it('rejects floats', () => {
		expect(() => amountMinor.parse(150.5)).toThrow();
	});
});

describe('addMoney', () => {
	it('adds same-currency amounts', () => {
		expect(addMoney(zeroMoney(), { amount_minor: 500, currency: 'PHP' })).toEqual({
			amount_minor: 500,
			currency: 'PHP'
		});
	});
	it('rejects currency mismatch', () => {
		expect(() =>
			// @ts-expect-error deliberately wrong currency
			addMoney({ amount_minor: 1, currency: 'PHP' }, { amount_minor: 1, currency: 'USD' })
		).toThrow(/currency mismatch/);
	});
});

describe('money schema', () => {
	it('round-trips', () => {
		const m = { amount_minor: 12345, currency: 'PHP' as const };
		expect(money.parse(m)).toEqual(m);
	});
});

describe('personRef', () => {
	it('accepts a well-formed ref', () => {
		expect(personRef.parse('per_01J9ZQ8XK3M4N5P6R7S8T9V0WX')).toBeTruthy();
	});
	it('rejects a malformed ref', () => {
		expect(() => personRef.parse('person-123')).toThrow();
	});
});
