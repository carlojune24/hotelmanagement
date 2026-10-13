import { describe, expect, it } from 'vitest';
import { assignSchema, endAssignmentSchema, isOpenOn } from './registry-schema';

const ID = '4b3f6a52-2a1c-4f4e-9b5d-0c6f1a9d7e21';

describe('assignSchema', () => {
	it('accepts a complete assignment and treats a ticked box as primary', () => {
		const r = assignSchema.safeParse({
			employeeId: ID,
			establishmentId: ID,
			startDate: '2026-10-01',
			position: 'Cook',
			makePrimary: 'on'
		});
		expect(r.success).toBe(true);
	});
	it('needs a post and a real date', () => {
		expect(assignSchema.safeParse({ employeeId: ID, establishmentId: ID, startDate: '2026-10-01', position: ' ' }).success).toBe(false);
		expect(assignSchema.safeParse({ employeeId: ID, establishmentId: ID, startDate: 'soon', position: 'Cook' }).success).toBe(false);
	});
});

describe('endAssignmentSchema', () => {
	it('needs a date', () => {
		expect(endAssignmentSchema.safeParse({ assignmentId: ID, endDate: '2026-10-31' }).success).toBe(true);
		expect(endAssignmentSchema.safeParse({ assignmentId: ID, endDate: '' }).success).toBe(false);
	});
});

describe('isOpenOn', () => {
	it('is inclusive of the end date and respects the start', () => {
		const a = { startDate: '2026-10-01', endDate: '2026-10-31' };
		expect(isOpenOn(a, '2026-09-30')).toBe(false);
		expect(isOpenOn(a, '2026-10-01')).toBe(true);
		expect(isOpenOn(a, '2026-10-31')).toBe(true);
		expect(isOpenOn(a, '2026-11-01')).toBe(false);
		expect(isOpenOn({ startDate: '2026-10-01', endDate: null }, '2030-01-01')).toBe(true);
	});
});
