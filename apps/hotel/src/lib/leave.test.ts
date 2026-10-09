import { describe, expect, it } from 'vitest';
import {
	LEAVE_DEFAULTS,
	countLeaveDays,
	eligibilityError,
	leavesOverlap,
	serviceMonths
} from './leave';

describe('serviceMonths', () => {
	it('counts whole months and never goes negative', () => {
		expect(serviceMonths('2025-10-15', '2026-10-14')).toBe(11);
		expect(serviceMonths('2025-10-15', '2026-10-15')).toBe(12);
		expect(serviceMonths('2026-10-15', '2025-01-01')).toBe(0);
	});
});

describe('eligibilityError', () => {
	const sil = LEAVE_DEFAULTS.find((l) => l.code === 'SIL')!;
	const ml = LEAVE_DEFAULTS.find((l) => l.code === 'ML')!;
	const emp = { hiredOn: '2026-01-01', employmentType: 'regular', sex: 'male' };

	it('blocks short service', () => {
		expect(eligibilityError(sil, emp, '2026-10-12')).toMatch(/12 months/);
		expect(eligibilityError(sil, { ...emp, hiredOn: '2025-01-01' }, '2026-10-12')).toBeNull();
	});
	it('blocks by sex', () => {
		expect(eligibilityError(ml, emp, '2026-10-12')).toMatch(/female/);
		expect(eligibilityError(ml, { ...emp, sex: 'female' }, '2026-10-12')).toBeNull();
	});
	it('blocks by employment type only when types are listed', () => {
		const p = { ...sil, minServiceMonths: 0, employmentTypes: ['regular'] };
		expect(eligibilityError(p, { ...emp, employmentType: 'casual' }, '2026-10-12')).toMatch(/casual/);
		expect(eligibilityError({ ...p, employmentTypes: [] }, { ...emp, employmentType: 'casual' }, '2026-10-12')).toBeNull();
	});
});

describe('countLeaveDays', () => {
	const work = new Set(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
	it('working days skip unrostered/rest days', () => {
		expect(
			countLeaveDays({ dayCount: 'working', start: '2026-10-10', end: '2026-10-18', workDates: work, halfDay: null })
		).toBe(5);
	});
	it('calendar days count every date', () => {
		expect(
			countLeaveDays({ dayCount: 'calendar', start: '2026-10-10', end: '2026-10-18', workDates: work, halfDay: null })
		).toBe(9);
	});
	it('half day is 0.5, and 0 when the day is not a work day', () => {
		const one = { dayCount: 'working' as const, start: '2026-10-12', end: '2026-10-12', halfDay: 'am' as const };
		expect(countLeaveDays({ ...one, workDates: work })).toBe(0.5);
		expect(countLeaveDays({ ...one, workDates: new Set() })).toBe(0);
	});
});

describe('leavesOverlap', () => {
	const r = (start: string, end: string, halfDay: string | null = null) => ({ start, end, halfDay });
	it('detects overlap and adjacency', () => {
		expect(leavesOverlap(r('2026-10-12', '2026-10-14'), r('2026-10-14', '2026-10-16'))).toBe(true);
		expect(leavesOverlap(r('2026-10-12', '2026-10-13'), r('2026-10-14', '2026-10-16'))).toBe(false);
	});
	it('allows opposite half days on one date', () => {
		expect(leavesOverlap(r('2026-10-12', '2026-10-12', 'am'), r('2026-10-12', '2026-10-12', 'pm'))).toBe(false);
		expect(leavesOverlap(r('2026-10-12', '2026-10-12', 'am'), r('2026-10-12', '2026-10-12', 'am'))).toBe(true);
	});
});
