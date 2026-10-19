import { describe, expect, it } from 'vitest';
import { generateRecoveryCode, hashRecovery, looksLikeRecovery, normalizeRecovery } from './recovery';

describe('recovery codes, pure parts', () => {
	it('are 8 letters in two groups, never using look-alike characters', () => {
		for (let i = 0; i < 2000; i++) {
			const c = generateRecoveryCode();
			expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
		}
	});

	it('are different each time', () => {
		const set = new Set(Array.from({ length: 500 }, generateRecoveryCode));
		expect(set.size).toBe(500);
	});

	it('read the same typed any way: upper or lower case, with or without the dash or spaces', () => {
		expect(normalizeRecovery('abcd-efgh')).toBe('ABCDEFGH');
		expect(normalizeRecovery(' ABCD EFGH ')).toBe('ABCDEFGH');
		expect(hashRecovery('u1', 'abcd-efgh')).toBe(hashRecovery('u1', 'ABCDEFGH'));
	});

	it('are bound to their owner', () => {
		expect(hashRecovery('u1', 'ABCD-EFGH')).not.toBe(hashRecovery('u2', 'ABCD-EFGH'));
	});

	it('are told apart from the 6-digit emailed code', () => {
		expect(looksLikeRecovery('ABCD-EFGH')).toBe(true);
		expect(looksLikeRecovery('abcdefgh')).toBe(true);
		expect(looksLikeRecovery('123456')).toBe(false);
		expect(looksLikeRecovery('ABCD-EFG')).toBe(false);
		expect(looksLikeRecovery('ABCD-EFGO')).toBe(false); // O is not in the alphabet
		expect(looksLikeRecovery('')).toBe(false);
	});
});
