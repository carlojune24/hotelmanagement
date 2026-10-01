import { describe, expect, it } from 'vitest';
import { applicationSchema, canTransition, slugify } from './applications';

describe('canTransition', () => {
	it('allows the review flow and blocks skipping finalize', () => {
		expect(canTransition('pending', 'approved')).toBe(true);
		expect(canTransition('approved', 'finalized')).toBe(true);
		expect(canTransition('pending', 'finalized')).toBe(false);
		expect(canTransition('rejected', 'approved')).toBe(false);
		expect(canTransition('rejected', 'pending')).toBe(true);
		expect(canTransition('finalized', 'rejected')).toBe(false);
	});
});

describe('slugify', () => {
	it('makes a valid slug or returns empty', () => {
		expect(slugify("Café del Mar — Beach Resort!")).toBe('cafe-del-mar-beach-resort');
		expect(slugify('  A  ')).toBe('');
		expect(slugify('x'.repeat(60)).length).toBeLessThanOrEqual(40);
	});
});

describe('applicationSchema', () => {
	const base = { hotelName: 'Seaside Inn', contactName: 'Ana Cruz', contactEmail: ' ANA@Example.com ' };
	it('accepts a minimal application and normalizes email', () => {
		const r = applicationSchema.safeParse({ ...base, city: '', permitExpiresOn: '', declaredRooms: '' });
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.contactEmail).toBe('ana@example.com');
			expect(r.data.city).toBeUndefined();
			expect(r.data.declaredRooms).toBeUndefined();
		}
	});
	it('rejects bad email, bad date, and non-positive rooms', () => {
		expect(applicationSchema.safeParse({ ...base, contactEmail: 'nope' }).success).toBe(false);
		expect(applicationSchema.safeParse({ ...base, permitExpiresOn: '31/12/2026' }).success).toBe(false);
		expect(applicationSchema.safeParse({ ...base, declaredRooms: '0' }).success).toBe(false);
	});
});
