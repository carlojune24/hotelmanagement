import { describe, expect, it } from 'vitest';
import { homePathFor, isDiningOnly, isKitchenOnly, roleCan, ROLE_CAPS } from './authz';

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

	it('gives a cook the Kitchen and nothing else', () => {
		expect(roleCan(ROLE_CAPS.kitchen, 'kitchen:read')).toBe(true);
		expect(roleCan(ROLE_CAPS.kitchen, 'kitchen:write')).toBe(true);
		expect(roleCan(ROLE_CAPS.kitchen, 'kitchen:manage')).toBe(false);
		for (const cap of ['dining:read', 'dining:write', 'payment:create', 'finance:read', 'booking:read', 'hotel:admin']) {
			expect(roleCan(ROLE_CAPS.kitchen, cap)).toBe(false);
		}
	});

	it('keeps starting and finishing dishes with the Kitchen, not front desk', () => {
		expect(roleCan(ROLE_CAPS.front_desk, 'kitchen:read')).toBe(true);
		expect(roleCan(ROLE_CAPS.front_desk, 'kitchen:write')).toBe(false);
		expect(roleCan(ROLE_CAPS.hotel_admin, 'kitchen:manage')).toBe(true);
		expect(roleCan(ROLE_CAPS.read_only, 'kitchen:write')).toBe(false);
	});

	it('lands only cook-only roles on the Kitchen', () => {
		expect(isKitchenOnly(ROLE_CAPS.kitchen)).toBe(true);
		for (const role of ['hotel_admin', 'front_desk', 'housekeeping', 'accountant', 'hr', 'read_only'] as const) {
			expect(isKitchenOnly(ROLE_CAPS[role])).toBe(false);
		}
	});
});

describe('homePathFor', () => {
	const base = '/hotel1/management';
	it('sends a cook straight to the Kitchen', () => {
		expect(homePathFor(base, ROLE_CAPS.kitchen)).toBe('/hotel1/management/kitchen');
	});
	it('sends everyone else to the Dashboard', () => {
		for (const role of ['hotel_admin', 'front_desk', 'housekeeping', 'accountant', 'hr', 'read_only'] as const) {
			expect(homePathFor(base, ROLE_CAPS[role])).toBe('/hotel1/management/dashboard');
		}
		expect(homePathFor(base, null)).toBe('/hotel1/management/dashboard');
		expect(homePathFor(base, undefined)).toBe('/hotel1/management/dashboard');
	});
	it('does not treat a platform admin as a cook, even with a kitchen-only role', () => {
		expect(homePathFor(base, ROLE_CAPS.kitchen, true)).toBe('/hotel1/management/dashboard');
	});
	it('works for a custom domain, where the management root has no slug', () => {
		expect(homePathFor('/management', ROLE_CAPS.kitchen)).toBe('/management/kitchen');
	});
});

describe('the dining role', () => {
	it('runs Dining end to end (orders, floor layout, QR codes, menu) and nothing else', () => {
		expect(ROLE_CAPS.dining).toEqual(['dining:read', 'dining:write', 'dining:manage']);
		expect(roleCan(ROLE_CAPS.dining, 'dining:manage')).toBe(true); // areas, tables, QR codes, menu
		for (const cap of ['kitchen:read', 'booking:read', 'room:read', 'finance:read', 'payment:create', 'hotel:admin', 'team:read']) {
			expect(roleCan(ROLE_CAPS.dining, cap)).toBe(false);
		}
	});
	it('is "dining only"; front desk and the manager are not', () => {
		expect(isDiningOnly(ROLE_CAPS.dining)).toBe(true);
		for (const role of ['hotel_admin', 'front_desk', 'housekeeping', 'kitchen', 'accountant', 'hr', 'read_only'] as const) {
			expect(isDiningOnly(ROLE_CAPS[role])).toBe(false);
		}
		expect(isKitchenOnly(ROLE_CAPS.dining)).toBe(false);
	});
	it('lands on Dining after sign-in, unless the user is a platform admin', () => {
		expect(homePathFor('/hotel1/management', ROLE_CAPS.dining)).toBe('/hotel1/management/dining');
		expect(homePathFor('/hotel1/management', ROLE_CAPS.dining, true)).toBe('/hotel1/management/dashboard');
	});
});
