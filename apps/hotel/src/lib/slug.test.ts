import { describe, expect, it } from 'vitest';
import { isValidSlug, slugError } from './slug';

describe('isValidSlug', () => {
	it('accepts normal slugs', () => {
		expect(isValidSlug('hotel1')).toBe(true);
		expect(isValidSlug('seaside-inn')).toBe(true);
	});

	it('rejects reserved prefixes', () => {
		expect(isValidSlug('admin')).toBe(false);
		expect(isValidSlug('api')).toBe(false);
		expect(isValidSlug('webhooks')).toBe(false);
	});

	it('rejects bad shapes', () => {
		expect(isValidSlug('ab')).toBe(false); // too short
		expect(isValidSlug('-lead')).toBe(false);
		expect(isValidSlug('trail-')).toBe(false);
		expect(isValidSlug('Upper')).toBe(false);
		expect(isValidSlug('has space')).toBe(false);
	});

	it('slugError explains why', () => {
		expect(slugError('admin')).toMatch(/reserved/);
		expect(slugError('ab')).toMatch(/lowercase/);
		expect(slugError('hotel1')).toBeNull();
	});
});
