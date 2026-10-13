import { describe, expect, it } from 'vitest';
import {
	changePasswordSchema,
	createUserSchema,
	removesLastMainHr,
	updateUserSchema
} from './user-schema';

const EST = '4b3f6a52-2a1c-4f4e-9b5d-0c6f1a9d7e21';
const good = { name: 'Ana', email: 'Ana@Example.com', password: 'a-long-enough-pass' };

describe('createUserSchema', () => {
	it('accepts Main HR with no establishments and lowercases the email', () => {
		const r = createUserSchema.safeParse({ ...good, role: 'main_hr', establishmentIds: [] });
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.email).toBe('ana@example.com');
	});
	it('accepts a manager scoped to an establishment', () => {
		expect(
			createUserSchema.safeParse({ ...good, role: 'business_manager', establishmentIds: [EST] }).success
		).toBe(true);
	});
	it('rejects a manager with no establishment', () => {
		expect(createUserSchema.safeParse({ ...good, role: 'business_manager', establishmentIds: [] }).success).toBe(false);
	});
	it('rejects an organization-wide role that also lists establishments', () => {
		expect(createUserSchema.safeParse({ ...good, role: 'main_hr', establishmentIds: [EST] }).success).toBe(false);
	});
	it('rejects a short password and an unknown role', () => {
		expect(createUserSchema.safeParse({ ...good, password: 'short', role: 'main_hr' }).success).toBe(false);
		expect(createUserSchema.safeParse({ ...good, role: 'god', establishmentIds: [] }).success).toBe(false);
	});
});

describe('updateUserSchema', () => {
	it('needs a valid status', () => {
		const base = { id: EST, name: 'Ana', role: 'hr_clerk', establishmentIds: [EST] };
		expect(updateUserSchema.safeParse({ ...base, status: 'active' }).success).toBe(true);
		expect(updateUserSchema.safeParse({ ...base, status: 'deleted' }).success).toBe(false);
	});
});

describe('changePasswordSchema', () => {
	it('requires matching, long-enough new passwords', () => {
		expect(changePasswordSchema.safeParse({ current: 'x', next: 'a-long-enough-pass', confirm: 'a-long-enough-pass' }).success).toBe(true);
		expect(changePasswordSchema.safeParse({ current: 'x', next: 'a-long-enough-pass', confirm: 'different-pass-1' }).success).toBe(false);
	});
});

describe('removesLastMainHr', () => {
	it('blocks only when the last active Main HR would stop being one', () => {
		expect(removesLastMainHr({ targetIsActiveMainHr: true, staysActiveMainHr: false, otherActiveMainHrCount: 0 })).toBe(true);
		expect(removesLastMainHr({ targetIsActiveMainHr: true, staysActiveMainHr: false, otherActiveMainHrCount: 1 })).toBe(false);
		expect(removesLastMainHr({ targetIsActiveMainHr: true, staysActiveMainHr: true, otherActiveMainHrCount: 0 })).toBe(false);
		expect(removesLastMainHr({ targetIsActiveMainHr: false, staysActiveMainHr: false, otherActiveMainHrCount: 0 })).toBe(false);
	});
});
