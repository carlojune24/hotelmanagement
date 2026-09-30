import { describe, expect, it } from 'vitest';
import {
	addDays,
	buildShiftLegend,
	codeFor,
	computeRosterWarnings,
	datesBetween,
	crossesMidnight,
	formatHours,
	isDateString,
	mondayOf,
	monthBounds,
	netShiftMinutes,
	shiftSpanMinutes,
	timeToMinutes,
	toHHMM,
	weekDates
} from './roster';

describe('times', () => {
	it('parses HH:MM and Postgres HH:MM:SS', () => {
		expect(timeToMinutes('07:30')).toBe(450);
		expect(timeToMinutes('07:30:00')).toBe(450);
		expect(toHHMM('07:30:00')).toBe('07:30');
	});

	it('rejects unset and malformed times', () => {
		expect(timeToMinutes(null)).toBeNull();
		expect(timeToMinutes('')).toBeNull();
		expect(timeToMinutes('24:00')).toBeNull();
		expect(timeToMinutes('7:30')).toBeNull();
		expect(toHHMM('nope')).toBeNull();
	});
});

describe('shift duration', () => {
	it('spans a same-day shift', () => {
		expect(shiftSpanMinutes('07:00', '15:00')).toBe(8 * 60);
	});

	it('treats end < start as ending the next day', () => {
		expect(shiftSpanMinutes('22:00', '06:00')).toBe(8 * 60);
		expect(crossesMidnight('22:00', '06:00')).toBe(true);
		expect(crossesMidnight('07:00', '15:00')).toBe(false);
	});

	it('is 0 when start equals end or a time is missing', () => {
		expect(shiftSpanMinutes('07:00', '07:00')).toBe(0);
		expect(shiftSpanMinutes('07:00', null)).toBe(0);
		expect(crossesMidnight(null, '06:00')).toBe(false);
	});

	it('subtracts the unpaid break, never below zero', () => {
		const base = { isRestDay: false, startTime: '07:00', endTime: '15:00' };
		expect(netShiftMinutes({ ...base, breakMinutes: 60 })).toBe(7 * 60);
		expect(netShiftMinutes({ ...base, breakMinutes: 600 })).toBe(0);
	});

	it('counts a rest day as 0 even if times linger', () => {
		expect(
			netShiftMinutes({ isRestDay: true, startTime: '07:00', endTime: '15:00', breakMinutes: 0 })
		).toBe(0);
	});

	it('formats hours', () => {
		expect(formatHours(480)).toBe('8h');
		expect(formatHours(510)).toBe('8h 30m');
	});
});

describe('week maths', () => {
	it('finds the Monday on or before any day', () => {
		expect(mondayOf('2026-09-30')).toBe('2026-09-28'); // Wednesday
		expect(mondayOf('2026-09-28')).toBe('2026-09-28'); // Monday
		expect(mondayOf('2026-10-04')).toBe('2026-09-28'); // Sunday belongs to the week before
	});

	it('crosses month and year boundaries', () => {
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
		expect(weekDates('2026-12-28')).toEqual([
			'2026-12-28',
			'2026-12-29',
			'2026-12-30',
			'2026-12-31',
			'2027-01-01',
			'2027-01-02',
			'2027-01-03'
		]);
	});

	it('validates date strings', () => {
		expect(isDateString('2026-09-30')).toBe(true);
		expect(isDateString('2026-13-40')).toBe(false);
		expect(isDateString('30-09-2026')).toBe(false);
	});
});

describe('computeRosterWarnings', () => {
	const shift = (employeeId: string, date: string, start = '07:00', end = '15:00') => ({
		employeeId,
		date,
		isRestDay: false,
		startTime: start,
		endTime: end,
		breakMinutes: 60
	});

	it('is quiet for an ordinary week', () => {
		expect(
			computeRosterWarnings({
				employees: [{ id: 'a', status: 'active' }],
				entries: [shift('a', '2026-09-28'), shift('a', '2026-09-29')]
			})
		).toEqual([]);
	});

	it('flags a working shift for an employee who is on leave, suspended or separated', () => {
		for (const status of ['on_leave', 'suspended', 'separated']) {
			const w = computeRosterWarnings({
				employees: [{ id: 'a', status }],
				entries: [shift('a', '2026-09-28')]
			});
			expect(w).toHaveLength(1);
			expect(w[0]).toMatchObject({ kind: 'status', severity: 'review', date: '2026-09-28' });
		}
	});

	it('does not flag a rest day for an employee on leave', () => {
		const w = computeRosterWarnings({
			employees: [{ id: 'a', status: 'on_leave' }],
			entries: [
				{
					employeeId: 'a',
					date: '2026-09-28',
					isRestDay: true,
					startTime: null,
					endTime: null,
					breakMinutes: 0
				}
			]
		});
		expect(w).toEqual([]);
	});

	it('marks an overnight shift as info, not review', () => {
		const w = computeRosterWarnings({
			employees: [{ id: 'a', status: 'active' }],
			entries: [shift('a', '2026-09-28', '22:00', '06:00')]
		});
		expect(w).toEqual([
			expect.objectContaining({ kind: 'overnight', severity: 'info', date: '2026-09-28' })
		]);
	});

	it('flags weekly hours only when strictly over the threshold', () => {
		// 7 paid hours a day (8h span - 60m break): 7 days = 49h → over 48h; 6 days = 42h → fine.
		const days = (n: number) =>
			Array.from({ length: n }, (_, i) => shift('a', addDays('2026-09-28', i)));
		const over = computeRosterWarnings({
			employees: [{ id: 'a', status: 'active' }],
			entries: days(7)
		});
		expect(over).toEqual([
			expect.objectContaining({ kind: 'weekly_hours', date: null, severity: 'review' })
		]);
		const under = computeRosterWarnings({
			employees: [{ id: 'a', status: 'active' }],
			entries: days(6)
		});
		expect(under).toEqual([]);

		const exactly = computeRosterWarnings({
			employees: [{ id: 'a', status: 'active' }],
			entries: days(6),
			thresholdMinutes: 42 * 60
		});
		expect(exactly).toEqual([]);
	});
});

describe('month bounds and ranges', () => {
	it('finds the first and last day, including leap February and December', () => {
		expect(monthBounds('2026-09-30')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
		expect(monthBounds('2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
		expect(monthBounds('2026-02-10').end).toBe('2026-02-28');
		expect(monthBounds('2026-12-05')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
	});

	it('lists every date inclusively', () => {
		expect(datesBetween('2026-09-29', '2026-10-02')).toEqual([
			'2026-09-29',
			'2026-09-30',
			'2026-10-01',
			'2026-10-02'
		]);
		expect(datesBetween('2026-09-01', '2026-09-30')).toHaveLength(30);
	});
});

describe('shift legend', () => {
	const morning = { isRestDay: false, startTime: '07:00', endTime: '15:00', breakMinutes: 60 };
	const night = { isRestDay: false, startTime: '23:00', endTime: '07:00', breakMinutes: 60 };
	const rest = { isRestDay: true, startTime: null, endTime: null, breakMinutes: 0 };
	const templates = [
		{ name: 'Morning', ...morning },
		{ name: 'Night', ...night },
		{ name: 'Rest day', ...rest }
	];

	it('uses template initials and only lists shifts actually used', () => {
		const legend = buildShiftLegend([morning, morning, rest], templates);
		expect(legend.map((e) => [e.code, e.label])).toEqual([
			['M', 'Morning'],
			['R', 'Rest day']
		]);
		expect(codeFor(morning, legend)).toBe('M');
		expect(codeFor(night, legend)).toBe('?'); // not in this legend
	});

	it('disambiguates templates that share an initial', () => {
		const mid = { ...morning, startTime: '10:00', endTime: '18:00' };
		const legend = buildShiftLegend(
			[morning, mid],
			[
				{ name: 'Morning', ...morning },
				{ name: 'Mid', ...mid }
			]
		);
		expect(legend.map((e) => e.code)).toEqual(['M', 'M2']);
	});

	it('codes one-off custom hours X, X2 so every cell can be decoded', () => {
		const a = { ...morning, startTime: '09:00', endTime: '17:00' };
		const b = { ...morning, startTime: '08:30', endTime: '16:30' };
		const legend = buildShiftLegend([a, b, morning], templates);
		expect(legend.map((e) => e.code)).toEqual(['M', 'X', 'X2']);
		expect(legend[1]?.label).toBe('Custom hours');
		expect(codeFor(b, legend)).toBe('X2');
	});

	it('does not let a one-off take a template initial', () => {
		const odd = { ...morning, startTime: '06:00', endTime: '14:00' };
		const legend = buildShiftLegend([odd, morning], templates);
		expect(codeFor(morning, legend)).toBe('M');
		expect(codeFor(odd, legend)).toBe('X');
	});

	it('treats a rest day as one shift regardless of lingering times', () => {
		const legend = buildShiftLegend([rest, { ...rest, startTime: '07:00' }], templates);
		expect(legend).toHaveLength(1);
	});
});
