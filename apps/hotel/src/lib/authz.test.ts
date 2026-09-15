import { describe, expect, it } from 'vitest';
import { roleCan, ROLE_CAPS } from './authz';

describe('roleCan', () => {
	it('hotel_admin can do anything', () => {
		expect(roleCan(ROLE_CAPS.hotel_admin, 'payroll:run')).toBe(true);
		expect(roleCan(ROLE_CAPS.hotel_admin, 'anything:at:all')).toBe(true);
	});

	it('domain wildcards match', () => {
		expect(roleCan(ROLE_CAPS.front_desk, 'booking:create')).toBe(true);
		expect(roleCan(ROLE_CAPS.accountant, 'finance:post')).toBe(true);
	});

	it('unrelated capabilities are denied', () => {
		expect(roleCan(ROLE_CAPS.housekeeping, 'payroll:run')).toBe(false);
		expect(roleCan(ROLE_CAPS.read_only, 'finance:post')).toBe(false);
	});

	it('read_only gets read wildcards only', () => {
		expect(roleCan(ROLE_CAPS.read_only, 'booking:read')).toBe(true);
		expect(roleCan(ROLE_CAPS.read_only, 'booking:create')).toBe(false);
	});

	it('front desk can cashier but not run the finance back office', () => {
		expect(roleCan(ROLE_CAPS.front_desk, 'payment:record')).toBe(true);
		expect(roleCan(ROLE_CAPS.front_desk, 'shift:open')).toBe(true);
		expect(roleCan(ROLE_CAPS.front_desk, 'finance:read')).toBe(true);
		expect(roleCan(ROLE_CAPS.front_desk, 'finance:write')).toBe(false);
		expect(roleCan(ROLE_CAPS.front_desk, 'expense:create')).toBe(false);
		expect(roleCan(ROLE_CAPS.front_desk, 'dayclose:run')).toBe(false);
	});

	it('accountant runs the finance back office', () => {
		expect(roleCan(ROLE_CAPS.accountant, 'expense:create')).toBe(true);
		expect(roleCan(ROLE_CAPS.accountant, 'receivable:write_off')).toBe(true);
		expect(roleCan(ROLE_CAPS.accountant, 'dayclose:run')).toBe(true);
		expect(roleCan(ROLE_CAPS.accountant, 'shift:close')).toBe(true);
	});

	it('hr manages employees/schedule/dtr/payroll but not cash-drawer shifts', () => {
		expect(roleCan(ROLE_CAPS.hr, 'hr:read')).toBe(true);
		expect(roleCan(ROLE_CAPS.hr, 'employee:read')).toBe(true);
		expect(roleCan(ROLE_CAPS.hr, 'schedule:write')).toBe(true);
		expect(roleCan(ROLE_CAPS.hr, 'dtr:read')).toBe(true);
		expect(roleCan(ROLE_CAPS.hr, 'payroll:run')).toBe(true);
		expect(roleCan(ROLE_CAPS.hr, 'reports:read')).toBe(true);
		// 'shift:*' is the cash-drawer domain (front_desk/accountant) — hr must not get it,
		// and front_desk's cash-drawer access must not satisfy hr's schedule/dtr domains.
		expect(roleCan(ROLE_CAPS.hr, 'shift:open')).toBe(false);
		expect(roleCan(ROLE_CAPS.front_desk, 'schedule:write')).toBe(false);
		expect(roleCan(ROLE_CAPS.front_desk, 'employee:read')).toBe(false);
	});

	it('only hotel_admin satisfies the hotel:admin settings gate', () => {
		expect(roleCan(ROLE_CAPS.hotel_admin, 'hotel:admin')).toBe(true);
		expect(roleCan(ROLE_CAPS.front_desk, 'hotel:admin')).toBe(false);
		expect(roleCan(ROLE_CAPS.accountant, 'hotel:admin')).toBe(false);
		expect(roleCan(ROLE_CAPS.hr, 'hotel:admin')).toBe(false);
		expect(roleCan(ROLE_CAPS.read_only, 'hotel:admin')).toBe(false);
	});
});
