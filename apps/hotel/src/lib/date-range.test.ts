import { describe, expect, it } from 'vitest';
import { resolveRange } from './date-range';

describe('resolveRange', () => {
	it('defaults to today', () => {
		expect(resolveRange(null, null, null, '2026-09-20')).toEqual({
			preset: 'today',
			from: '2026-09-20',
			to: '2026-09-20'
		});
	});
	it('week is Monday–Sunday (2026-09-20 is a Sunday)', () => {
		expect(resolveRange('week', null, null, '2026-09-20')).toMatchObject({
			from: '2026-09-14',
			to: '2026-09-20'
		});
		expect(resolveRange('week', null, null, '2026-09-21')).toMatchObject({
			from: '2026-09-21',
			to: '2026-09-27'
		});
	});
	it('month covers the whole month, incl. leap February', () => {
		expect(resolveRange('month', null, null, '2026-09-20')).toMatchObject({
			from: '2026-09-01',
			to: '2026-09-30'
		});
		expect(resolveRange('month', null, null, '2028-02-10')).toMatchObject({
			from: '2028-02-01',
			to: '2028-02-29'
		});
	});
	it('custom keeps a valid range, swaps a reversed one, and falls back when invalid', () => {
		expect(resolveRange('custom', '2026-09-01', '2026-09-05', '2026-09-20')).toMatchObject({
			from: '2026-09-01',
			to: '2026-09-05'
		});
		expect(resolveRange('custom', '2026-09-05', '2026-09-01', '2026-09-20')).toMatchObject({
			from: '2026-09-01',
			to: '2026-09-05'
		});
		expect(resolveRange('custom', 'oops', null, '2026-09-20').preset).toBe('today');
	});
});
