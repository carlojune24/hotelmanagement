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
	it('forgot to punch in after lunch: break counted as scheduled, flagged', () => {
		const r = run(at(8), at(12), at(17));
		expect(r.flags).toEqual(['missing_break_in']);
		expect(r.metrics.workedMinutes).toBe(480);
	});
	it('forgot to punch out for lunch: flagged', () => {
		const r = run(at(8), at(13), at(17));
		expect(r.flags).toEqual(['missing_break_out']);
		expect(r.metrics.workedMinutes).toBe(480);
	});
	it('left at lunch and never came back: only the morning counts', () => {
		const r = run(at(8), at(12));
		expect(r.flags).toEqual(['no_return']);
		expect(r.metrics).toMatchObject({ workedMinutes: 240, undertimeMinutes: 240 });
	});
	it('worked straight through: normal day, break deducted', () => {
		const r = run(at(8), at(17));
		expect(r.flags).toEqual([]);
		expect(r.metrics.workedMinutes).toBe(480);
	});
	it('re-tapped lunch punches do not stretch the break', () => {
		const r = run(at(8), at(12), at(12, 1), at(12, 58), at(13), at(17));
		expect(r.metrics.workedMinutes).toBe(240 + 242);
	});
});
