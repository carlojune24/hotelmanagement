import { describe, expect, it } from 'vitest';
import { roleCan } from './authz';

describe('roleCan', () => {
	it('hotel_admin can do anything', () => {
		expect(roleCan('hotel_admin', 'payroll:run')).toBe(true);
		expect(roleCan('hotel_admin', 'anything:at:all')).toBe(true);
	});

	it('domain wildcards match', () => {
		expect(roleCan('front_desk', 'booking:create')).toBe(true);
		expect(roleCan('accountant', 'finance:post')).toBe(true);
	});

	it('unrelated capabilities are denied', () => {
		expect(roleCan('housekeeping', 'payroll:run')).toBe(false);
		expect(roleCan('read_only', 'finance:post')).toBe(false);
	});

	it('read_only gets read wildcards only', () => {
		expect(roleCan('read_only', 'booking:read')).toBe(true);
		expect(roleCan('read_only', 'booking:create')).toBe(false);
	});
});
