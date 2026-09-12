import { describe, expect, it } from 'vitest';
import { diffSegments, segCheckOutFor } from './booking-modify';

describe('diffSegments', () => {
	it('returns nothing when the range is unchanged', () => {
		expect(diffSegments('2026-01-10', '2026-01-13', '2026-01-10', '2026-01-13')).toEqual([]);
	});

	it('extends the back edge (later checkout)', () => {
		const segs = diffSegments('2026-01-10', '2026-01-13', '2026-01-10', '2026-01-15');
		expect(segs).toEqual([
			{ edge: 'back', direction: 'added', nights: ['2026-01-13', '2026-01-14'] }
		]);
	});

	it('shortens the back edge (earlier checkout)', () => {
		const segs = diffSegments('2026-01-10', '2026-01-13', '2026-01-10', '2026-01-12');
		expect(segs).toEqual([
			{ edge: 'back', direction: 'removed', nights: ['2026-01-12'] }
		]);
	});

	it('extends the front edge (earlier check-in)', () => {
		const segs = diffSegments('2026-01-10', '2026-01-13', '2026-01-08', '2026-01-13');
		expect(segs).toEqual([
			{ edge: 'front', direction: 'added', nights: ['2026-01-08', '2026-01-09'] }
		]);
	});

	it('shortens the front edge (later check-in)', () => {
		const segs = diffSegments('2026-01-10', '2026-01-13', '2026-01-11', '2026-01-13');
		expect(segs).toEqual([
			{ edge: 'front', direction: 'removed', nights: ['2026-01-10'] }
		]);
	});

	it('handles both edges changing at once', () => {
		const segs = diffSegments('2026-01-10', '2026-01-13', '2026-01-11', '2026-01-15');
		expect(segs).toEqual([
			{ edge: 'front', direction: 'removed', nights: ['2026-01-10'] },
			{ edge: 'back', direction: 'added', nights: ['2026-01-13', '2026-01-14'] }
		]);
	});
});

describe('segCheckOutFor', () => {
	it('is one day past the last night', () => {
		expect(segCheckOutFor(['2026-01-13', '2026-01-14'])).toBe('2026-01-15');
	});

	it('handles a single-night segment', () => {
		expect(segCheckOutFor(['2026-01-12'])).toBe('2026-01-13');
	});

	it('rolls over a month boundary', () => {
		expect(segCheckOutFor(['2026-01-30', '2026-01-31'])).toBe('2026-02-01');
	});
});
