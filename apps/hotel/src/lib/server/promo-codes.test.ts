import { describe, expect, it } from 'vitest';
import { normalizePromoCode } from './promo-codes';

describe('normalizePromoCode', () => {
	it('trims and uppercases', () => {
		expect(normalizePromoCode('  welcome10  ')).toBe('WELCOME10');
	});
	it('caps at the max length', () => {
		expect(normalizePromoCode('a'.repeat(50))).toBe('A'.repeat(40));
	});
	it('an empty/blank code normalizes to an empty string', () => {
		expect(normalizePromoCode('   ')).toBe('');
	});
});
