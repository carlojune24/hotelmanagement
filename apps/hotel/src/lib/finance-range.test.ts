import { describe, expect, it } from 'vitest';
import {
	addDays,
	endOfMonth,
	matchPreset,
	rangeLabel,
	resolveRange,
	sanitizeRange,
	startOfWeek
} from './finance-range';

const TODAY = '2026-09-09'; // a Wednesday

describe('date math', () => {
	it('addDays crosses months and years', () => {
		expect(addDays('2026-09-09', -10)).toBe('2026-08-30');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
	});
	it('startOfWeek is the Monday', () => {
		expect(startOfWeek('2026-09-09')).toBe('2026-09-07');
		expect(startOfWeek('2026-09-07')).toBe('2026-09-07'); // Monday itself
		expect(startOfWeek('2026-09-13')).toBe('2026-09-07'); // Sunday → same week
	});
	it('endOfMonth handles 30/31/28', () => {
		expect(endOfMonth('2026-09-01')).toBe('2026-09-30');
		expect(endOfMonth('2026-02-15')).toBe('2026-02-28');
		expect(endOfMonth('2026-01-31')).toBe('2026-01-31');
	});
});

describe('resolveRange', () => {
	it('today / yesterday', () => {
		expect(resolveRange('today', TODAY)).toEqual({ from: '2026-09-09', to: '2026-09-09' });
		expect(resolveRange('yesterday', TODAY)).toEqual({ from: '2026-09-08', to: '2026-09-08' });
	});
	it('this_week / this_month run up to today', () => {
		expect(resolveRange('this_week', TODAY)).toEqual({ from: '2026-09-07', to: '2026-09-09' });
		expect(resolveRange('this_month', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-09' });
	});
	it('last_month is the whole previous calendar month', () => {
		expect(resolveRange('last_month', TODAY)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
		expect(resolveRange('last_month', '2026-01-10')).toEqual({
			from: '2025-12-01',
			to: '2025-12-31'
		});
	});
});

describe('matchPreset / rangeLabel', () => {
	it('recognises a preset range', () => {
		expect(matchPreset('2026-09-01', '2026-09-09', TODAY)).toBe('this_month');
		expect(rangeLabel('2026-09-01', '2026-09-09', TODAY)).toBe('This month');
		expect(rangeLabel('2026-09-09', '2026-09-09', TODAY)).toBe('Today');
	});
	it('labels a custom single day and a custom span', () => {
		expect(matchPreset('2026-09-03', '2026-09-05', TODAY)).toBe('custom');
		expect(rangeLabel('2026-09-03', '2026-09-03', TODAY)).toBe('3 Sep 2026');
		expect(rangeLabel('2026-08-26', '2026-09-09', '2026-09-20')).toBe('26 Aug – 9 Sep 2026');
	});
});

describe('sanitizeRange', () => {
	it('defaults to today when params are missing or malformed', () => {
		expect(sanitizeRange(null, null, TODAY)).toEqual({ from: TODAY, to: TODAY });
		expect(sanitizeRange('nope', '2026-13-40', TODAY)).toEqual({ from: TODAY, to: TODAY });
	});
	it('swaps an inverted range and caps the span at 366 days', () => {
		expect(sanitizeRange('2026-09-09', '2026-09-01', TODAY)).toEqual({
			from: '2026-09-01',
			to: '2026-09-09'
		});
		const capped = sanitizeRange('2020-01-01', '2026-09-09', TODAY);
		expect(capped.to).toBe('2026-09-09');
		expect(addDays(capped.from, 366)).toBe('2026-09-09');
	});
});
