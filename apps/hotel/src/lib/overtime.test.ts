import { describe, expect, it } from 'vitest';
import { creditOvertime, overtimeMinutes, overtimeRangeError, rangesOverlap } from './overtime';

const m = (min: number) => min * 60_000;

describe('overtime range', () => {
	it('measures a same-day and a past-midnight range', () => {
		expect(overtimeMinutes('17:00', '19:30')).toBe(150);
		expect(overtimeMinutes('22:00', '01:00')).toBe(180);
	});
	it('rejects an empty or over-12h range', () => {
		expect(overtimeRangeError('17:00', '17:00')).not.toBeNull();
		expect(overtimeRangeError('06:00', '19:00')).not.toBeNull();
		expect(overtimeRangeError('17:00', '19:00')).toBeNull();
	});
	it('overlaps only when time is shared', () => {
		expect(rangesOverlap([0, m(60)], [m(30), m(90)])).toBe(true);
		expect(rangesOverlap([0, m(60)], [m(60), m(90)])).toBe(false);
	});
});

describe('creditOvertime', () => {
	const punched: [number, number] = [m(0), m(90)]; // 90 min past scheduled end
	it('credits everything when an application covers it', () => {
		expect(creditOvertime(punched, [[m(0), m(120)]])).toEqual({ approvedMinutes: 90, unapprovedMinutes: 0 });
	});
	it('credits only the covered part, and nothing with no application', () => {
		expect(creditOvertime(punched, [[m(0), m(30)]])).toEqual({ approvedMinutes: 30, unapprovedMinutes: 60 });
		expect(creditOvertime(punched, [])).toEqual({ approvedMinutes: 0, unapprovedMinutes: 90 });
	});
	it('does not credit approved time that was never worked', () => {
		expect(creditOvertime([m(0), m(30)], [[m(0), m(120)]])).toEqual({ approvedMinutes: 30, unapprovedMinutes: 0 });
		expect(creditOvertime(punched, [[m(120), m(180)]])).toEqual({ approvedMinutes: 0, unapprovedMinutes: 90 });
	});
	it('counts overlapping applications once', () => {
		expect(creditOvertime(punched, [[m(0), m(60)], [m(30), m(80)]])).toEqual({
			approvedMinutes: 80,
			unapprovedMinutes: 10
		});
	});
});
