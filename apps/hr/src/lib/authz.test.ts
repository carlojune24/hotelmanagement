import { describe, expect, it } from 'vitest';
import { ROLE_CAPS, canAnywhere, canAt, roleCan, type Access } from './authz';

const access = (orgRole: keyof typeof ROLE_CAPS | null, est: Record<string, keyof typeof ROLE_CAPS> = {}): Access => ({
	orgCaps: orgRole ? ROLE_CAPS[orgRole] : [],
	establishments: Object.fromEntries(Object.entries(est).map(([id, r]) => [id, ROLE_CAPS[r]]))
});

describe('roleCan', () => {
	it('honours * and domain/action wildcards', () => {
		expect(roleCan(['*'], 'payroll:run')).toBe(true);
		expect(roleCan(['*:read'], 'establishment:read')).toBe(true);
		expect(roleCan(['*:read'], 'establishment:write')).toBe(false);
		expect(roleCan(['establishment:*'], 'establishment:write')).toBe(true);
	});
});

describe('canAt', () => {
	it('main_hr can do anything org-wide', () => {
		expect(canAt(access('main_hr'), 'establishment:write')).toBe(true);
	});
	it('a manager is limited to their own establishment and cannot write', () => {
		const a = access(null, { A: 'business_manager' });
		expect(canAt(a, 'establishment:read', 'A')).toBe(true);
		expect(canAt(a, 'establishment:read', 'B')).toBe(false);
		expect(canAt(a, 'establishment:write', 'A')).toBe(false);
		expect(canAt(a, 'establishment:read')).toBe(false); // no org-wide read
	});
	it('read-only owner reads everywhere but never writes', () => {
		const a = access('owner_readonly');
		expect(canAt(a, 'establishment:read')).toBe(true);
		expect(canAt(a, 'establishment:write')).toBe(false);
	});
});

describe('canAnywhere', () => {
	it('is true for a manager at one establishment, false for no roles', () => {
		expect(canAnywhere(access(null, { A: 'hr_clerk' }), 'establishment:read')).toBe(true);
		expect(canAnywhere(access(null), 'establishment:read')).toBe(false);
	});
});
