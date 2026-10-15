import { describe, expect, it } from 'vitest';
import {
	clusterPunches,
	computeMetrics,
	detectDelimiter,
	normalizeEnrollId,
	parseDelimited,
	parseWallDateTime
} from './hr-import';

const min = (n: number) => n * 60_000;
const T0 = Date.UTC(2026, 9, 9, 0, 0); // arbitrary anchor
const at = (h: number, m = 0) => T0 + min(h * 60 + m);

describe('parseDelimited', () => {
	it('reads a ZKTeco ATTLOG line (tab separated, no header)', () => {
		const rows = parseDelimited('1042\t2026-10-09 07:58:12\t1\t1\t0\t0\n7\t2026-10-09 16:02:01\t1\t1\t0\t0\n');
		expect(rows[0]!.slice(0, 2)).toEqual(['1042', '2026-10-09 07:58:12']);
		expect(rows).toHaveLength(2);
	});
	it('reads quoted CSV cells containing the delimiter', () => {
		const rows = parseDelimited('ID,Name,Time\n5,"Cruz, Ana",10/9/2026 8:01 AM');
		expect(rows[1]).toEqual(['5', 'Cruz, Ana', '10/9/2026 8:01 AM']);
		expect(detectDelimiter('a,b\n1,2')).toBe(',');
	});
});

describe('parseWallDateTime', () => {
	it('parses ISO, with and without seconds', () => {
		expect(parseWallDateTime('2026-10-09 07:58:12')).toEqual({ date: '2026-10-09', time: '07:58:12' });
		expect(parseWallDateTime('2026-10-09T07:58')).toEqual({ date: '2026-10-09', time: '07:58:00' });
	});
	it('parses 12-hour month-first (auto) and day-first when chosen', () => {
		expect(parseWallDateTime('10/9/2026 4:05 PM')).toEqual({ date: '2026-10-09', time: '16:05:00' });
		expect(parseWallDateTime('12:30 AM'.replace('12:30 AM', '10/9/26 12:30 AM'))).toEqual({
			date: '2026-10-09',
			time: '00:30:00'
		});
		expect(parseWallDateTime('09/10/2026 07:58', 'dmy')).toEqual({ date: '2026-10-09', time: '07:58:00' });
	});
	it('rejects garbage and impossible dates', () => {
		expect(parseWallDateTime('hello')).toBeNull();
		expect(parseWallDateTime('2026-02-30 08:00')).toBeNull();
		expect(parseWallDateTime('2026-10-09 25:00')).toBeNull();
	});
});

describe('normalizeEnrollId', () => {
	it('treats 0042, 42 and 42.0 as the same id', () => {
		expect(normalizeEnrollId('0042')).toBe('42');
		expect(normalizeEnrollId('42.0')).toBe('42');
		expect(normalizeEnrollId(' 42 ')).toBe('42');
	});
});

describe('clusterPunches', () => {
	it('pairs first/last of a day and drops double taps', () => {
		const [c] = clusterPunches([at(7, 58), at(7, 59), at(12), at(16, 3)]);
		expect(c).toMatchObject({ inMs: at(7, 58), outMs: at(16, 3), punchCount: 3 });
		expect(c?.punches).toEqual([at(7, 58), at(12), at(16, 3)]);
	});
	it('splits shifts on a long silence and keeps an overnight shift together', () => {
		const clusters = clusterPunches([at(22), at(30), at(46), at(54)]); // 22:00→06:00 next day, then 22:00→06:00
		expect(clusters).toHaveLength(2);
		expect(clusters[0]!.outMs).toBe(at(30));
	});
	it('leaves a lone punch without an out', () => {
		expect(clusterPunches([at(8)])[0]!.outMs).toBeNull();
	});
});

/** A punch group built by hand: `punches` is just the in/out. */
const cl = (inMs: number, outMs: number | null, punchCount: number) => ({
	inMs,
	outMs,
	punchCount,
	punches: outMs === null ? [inMs] : [inMs, outMs]
});

describe('computeMetrics', () => {
	const sched = { isRestDay: false, startMs: at(7), endMs: at(15), breakMinutes: 60 };
	it('computes late, undertime and OT against the schedule', () => {
		const late = computeMetrics(cl(at(7, 10), at(14, 40), 2), sched, []);
		expect(late.metrics).toMatchObject({ workedMinutes: 390, tardinessMinutes: 10, undertimeMinutes: 20, otMinutes: 0 });
		const ot = computeMetrics(cl(at(7), at(16, 30), 2), sched, []);
		expect(ot.metrics).toMatchObject({ otMinutes: 90, tardinessMinutes: 0 });
	});
	it('counts night differential overlap', () => {
		const night = { isRestDay: false, startMs: at(22), endMs: at(30), breakMinutes: 0 };
		const r = computeMetrics(cl(at(22), at(30), 2), night, [[at(22), at(30)]]);
		expect(r.metrics.nightDiffMinutes).toBe(480);
	});
	it('flags a lone punch, a missing schedule and a rest day', () => {
		expect(computeMetrics(cl(at(8), null, 1), sched, []).flags).toContain('single_punch');
		const none = computeMetrics(cl(at(8), at(16), 2), null, []);
		expect(none.flags).toContain('no_schedule');
		expect(none.metrics).toMatchObject({ workedMinutes: 480, tardinessMinutes: 0, otMinutes: 0 });
		const rest = computeMetrics(
			cl(at(8), at(16), 2),
			{ isRestDay: true, startMs: null, endMs: null, breakMinutes: 0 },
			[]
		);
		expect(rest.flags).toContain('rest_day');
	});
});

describe('split shift 08:00-12:00 + 13:00-17:00', () => {
	const sched = {
		isRestDay: false,
		startMs: at(8),
		endMs: at(17),
		breakMinutes: 60,
		breakStartMs: at(12),
		breakEndMs: at(13)
	};
	const run = (...times: number[]) => computeMetrics(clusterPunches(times)[0]!, sched, []);

	it('a complete day is the sum of both parts', () => {
		const r = run(at(8), at(12), at(13), at(17));
		expect(r.flags).toEqual([]);
		expect(r.metrics).toMatchObject({ workedMinutes: 480, tardinessMinutes: 0, undertimeMinutes: 0, otMinutes: 0 });
	});
	it('late back from lunch counts as tardiness', () => {
		const r = run(at(8), at(12), at(13, 20), at(17));
		expect(r.metrics).toMatchObject({ workedMinutes: 460, tardinessMinutes: 20 });
	});
	it('no break-in: the afternoon cannot be proven, so the second part is late', () => {
		const r = run(at(8), at(12), at(17));
		expect(r.flags).toEqual(['missing_break_in']);
		expect(r.metrics).toMatchObject({ workedMinutes: 240, tardinessMinutes: 240, undertimeMinutes: 0 });
	});
	it('no break-out: the morning cannot be proven, so the first part is undertime', () => {
		const r = run(at(8), at(13), at(17));
		expect(r.flags).toEqual(['missing_break_out']);
		expect(r.metrics).toMatchObject({ workedMinutes: 240, tardinessMinutes: 0, undertimeMinutes: 240 });
	});
	it('no break punches at all on a defined break: the day is absent', () => {
		const r = run(at(8), at(17));
		expect(r.flags).toEqual(['missing_break_out', 'missing_break_in']);
		expect(r.metrics).toMatchObject({ workedMinutes: 0, tardinessMinutes: 0, undertimeMinutes: 0, otMinutes: 0 });
	});
	it('no break-out and a late arrival: the morning is not deducted twice', () => {
		const r = run(at(9), at(13), at(17));
		expect(r.metrics).toMatchObject({ workedMinutes: 240, tardinessMinutes: 60, undertimeMinutes: 180 });
	});
	it('left at lunch and never came back: only the morning counts', () => {
		const r = run(at(8), at(12));
		expect(r.flags).toEqual(['no_return']);
		expect(r.metrics).toMatchObject({ workedMinutes: 240, undertimeMinutes: 240 });
	});
	it('in and out only, no lunch taps, is absent (covered above); the break is not assumed', () => {
		expect(run(at(8), at(17)).metrics.workedMinutes).toBe(0);
	});
	it('re-tapped lunch punches do not stretch the break', () => {
		const r = run(at(8), at(12), at(12, 1), at(12, 58), at(13), at(17));
		expect(r.metrics.workedMinutes).toBe(240 + 242);
	});
});

describe('clusterPunches with the roster', () => {
	const at = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00Z`);

	it('overtime until 9 PM and an 8 AM clock-in next day are two shifts, not one', () => {
		const punches = [at('2026-03-02', '08:00'), at('2026-03-02', '21:00'), at('2026-03-03', '07:55'), at('2026-03-03', '17:00')];
		const starts = [at('2026-03-02', '08:00'), at('2026-03-03', '08:00')];
		const c = clusterPunches(punches, starts);
		expect(c).toHaveLength(2);
		expect(c[0]!.outMs).toBe(at('2026-03-02', '21:00'));
		expect(c[1]!.inMs).toBe(at('2026-03-03', '07:55'));
	});

	it('keeps a long split-shift break inside one shift', () => {
		const starts = [at('2026-03-02', '06:00'), at('2026-03-03', '06:00')];
		const punches = [at('2026-03-02', '06:00'), at('2026-03-02', '10:00'), at('2026-03-02', '18:00'), at('2026-03-02', '22:00')];
		expect(clusterPunches(punches, starts)).toHaveLength(1);
	});

	it('keeps a night shift together', () => {
		const starts = [at('2026-03-02', '22:00'), at('2026-03-03', '22:00')];
		const punches = [at('2026-03-02', '22:00'), at('2026-03-03', '02:00'), at('2026-03-03', '03:00'), at('2026-03-03', '06:00')];
		expect(clusterPunches(punches, starts)).toHaveLength(1);
	});
});
