import { describe, expect, it } from 'vitest';
import { addDays, resolveRange } from './dining-sales-range';

const url = (qs: string) => new URL(`http://x/?${qs}`);

describe('resolveRange', () => {
	it('defaults to today when nothing is given', () => {
		expect(resolveRange(url(''), '2026-10-08')).toEqual({ from: '2026-10-08', to: '2026-10-08' });
	});
	it('uses a single "from" as a one-day range', () => {
		expect(resolveRange(url('from=2026-10-01'), '2026-10-08')).toEqual({ from: '2026-10-01', to: '2026-10-01' });
	});
	it('keeps a valid range as given', () => {
		expect(resolveRange(url('from=2026-10-01&to=2026-10-07'), '2026-10-08')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
	});
	it('swaps a reversed range instead of returning nothing', () => {
		expect(resolveRange(url('from=2026-10-07&to=2026-10-01'), '2026-10-08')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
	});
	it('ignores anything that is not a plain date', () => {
		expect(resolveRange(url("from=2026-10-01'%3B--&to=tomorrow"), '2026-10-08')).toEqual({ from: '2026-10-08', to: '2026-10-08' });
	});
});

describe('addDays', () => {
	it('crosses month and year ends', () => {
		expect(addDays('2026-10-08', -6)).toBe('2026-10-02');
		expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
		expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
	});
});
