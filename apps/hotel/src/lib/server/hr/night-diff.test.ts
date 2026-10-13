import { describe, expect, it } from 'vitest';
import { DEFAULT_NIGHT_DIFF, mergeNightDiffIntoConfig, parseNightDiff } from './night-diff';

describe('night differential config', () => {
	it('falls back to 22:00–06:00 at 10% when unset or malformed', () => {
		expect(parseNightDiff({})).toEqual(DEFAULT_NIGHT_DIFF);
		expect(parseNightDiff(null)).toEqual(DEFAULT_NIGHT_DIFF);
		expect(parseNightDiff({ nightDiff: { start: 'x', end: '06:00', ratePct: 10 } })).toEqual(
			DEFAULT_NIGHT_DIFF
		);
		expect(parseNightDiff({ nightDiff: { start: '22:00', end: '22:00', ratePct: 10 } })).toEqual(
			DEFAULT_NIGHT_DIFF
		);
	});
	it('round-trips a saved value and keeps the other config keys', () => {
		const next = { start: '21:00', end: '05:00', ratePct: 12.5 };
		const merged = mergeNightDiffIntoConfig({ branding: { a: 1 } }, next);
		expect(merged).toEqual({ branding: { a: 1 }, nightDiff: next });
		expect(parseNightDiff(merged)).toEqual(next);
	});
});
