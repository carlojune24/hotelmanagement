import { dayRemarks } from '$lib/hr-import';
import { datesBetween, toHHMM } from '$lib/roster';
import type { GeneratedRecord } from '$lib/server/hr/dtr-import';
import type { listDtrEntries } from '$lib/server/hr/dtr';
import type { listSchedules } from '$lib/server/hr/schedules';

/** A time of day shown two ways: `7:48 AM` for screens, `07:48` for the printed sheet. */
export type Clock = { t12: string; t24: string } | null;

export type DtrDay = {
	date: string;
	weekday: string;
	/** `8a–12p · 1p–5p`, `Rest day`, or empty when nothing is rostered. */
	shift: string;
	timeIn: Clock;
	breakOut: Clock;
	breakIn: Clock;
	timeOut: Clock;
	workedMinutes: number;
	lateMinutes: number;
	undertimeMinutes: number;
	remarks: string;
	/** work = has times; absent / rest = that state; empty = nothing rostered or not yet happened. */
	kind: 'work' | 'absent' | 'rest' | 'empty';
	/** The row came from a staff-entered record rather than the biometric. */
	manual: boolean;
};

export type DtrTotals = {
	workedMinutes: number;
	lateMinutes: number;
	undertimeMinutes: number;
	absentDays: number;
	workedDays: number;
};

/** One day's times in a neutral shape, whether it came from a preview or a saved row. */
export type DayRecord = {
	timeIn: number | null;
	breakOut: number | null;
	breakIn: number | null;
	timeOut: number | null;
	workedMinutes: number;
	tardinessMinutes: number;
	undertimeMinutes: number;
	isAbsent: boolean;
	remarks: string;
	manual: boolean;
};

type RosterShift = Awaited<ReturnType<typeof listSchedules>>[number];
type SavedEntry = Awaited<ReturnType<typeof listDtrEntries>>[number];

export function recordFromGenerated(r: GeneratedRecord): DayRecord {
	return {
		timeIn: r.timeIn,
		breakOut: r.breakOut,
		breakIn: r.breakIn,
		timeOut: r.timeOut,
		workedMinutes: r.workedMinutes,
		tardinessMinutes: r.tardinessMinutes,
		undertimeMinutes: r.undertimeMinutes,
		isAbsent: r.isAbsent,
		remarks: r.isAbsent ? 'Absent' : dayRemarks(r.flags, r.manualPunch),
		manual: r.manualPunch
	};
}

export function recordFromSaved(e: SavedEntry): DayRecord {
	return {
		timeIn: e.timeIn?.getTime() ?? null,
		breakOut: e.breakOut?.getTime() ?? null,
		breakIn: e.breakIn?.getTime() ?? null,
		timeOut: e.timeOut?.getTime() ?? null,
		workedMinutes: e.workedMinutes,
		tardinessMinutes: e.tardinessMinutes,
		undertimeMinutes: e.undertimeMinutes,
		isAbsent: e.isAbsent,
		remarks: e.isAbsent ? 'Absent' : (e.remarks ?? (e.source === 'manual' ? 'Entered by staff' : '')),
		manual: e.source === 'manual'
	};
}

const t12 = (t: string | null) => {
	const v = toHHMM(t);
	if (!v) return '';
	const [h = 0, m = 0] = v.split(':').map(Number);
	const hh = h % 12 === 0 ? 12 : h % 12;
	return `${hh}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`;
};

function shiftLabel(s: RosterShift | undefined): string {
	if (!s) return '';
	if (s.isRestDay) return 'Rest day';
	if (!s.startTime || !s.endTime) return '';
	return s.breakStart && s.breakEnd
		? `${t12(s.startTime)}–${t12(s.breakStart)} · ${t12(s.breakEnd)}–${t12(s.endTime)}`
		: `${t12(s.startTime)}–${t12(s.endTime)}`;
}

/** Every calendar day of the month for one employee, from their roster and a day→times map. */
export function buildDtrDays(opts: {
	tz: string;
	range: { start: string; end: string };
	/** This employee's roster rows for the month. */
	roster: RosterShift[];
	records: Map<string, DayRecord>;
}): { days: DtrDay[]; totals: DtrTotals } {
	const { tz, range, roster, records } = opts;
	const f12 = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
	const f24 = new Intl.DateTimeFormat('en-GB', {
		timeZone: tz,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	});
	const clock = (ms: number | null): Clock =>
		ms === null ? null : { t12: f12.format(ms), t24: f24.format(ms) };
	const weekday = (d: string) =>
		new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
	const sched = new Map(roster.map((s) => [s.date, s]));

	const days: DtrDay[] = datesBetween(range.start, range.end).map((date) => {
		const s = sched.get(date);
		const rec = records.get(date);
		const base = { date, weekday: weekday(date), shift: shiftLabel(s) };
		if (rec?.isAbsent) {
			return {
				...base,
				timeIn: null,
				breakOut: null,
				breakIn: null,
				timeOut: null,
				workedMinutes: 0,
				lateMinutes: 0,
				undertimeMinutes: 0,
				remarks: rec.remarks || 'Absent',
				kind: 'absent' as const,
				manual: rec.manual
			};
		}
		if (rec) {
			return {
				...base,
				timeIn: clock(rec.timeIn),
				breakOut: clock(rec.breakOut),
				breakIn: clock(rec.breakIn),
				timeOut: clock(rec.timeOut),
				workedMinutes: rec.workedMinutes,
				lateMinutes: rec.tardinessMinutes,
				undertimeMinutes: rec.undertimeMinutes,
				remarks: rec.remarks,
				kind: 'work' as const,
				manual: rec.manual
			};
		}
		return {
			...base,
			timeIn: null,
			breakOut: null,
			breakIn: null,
			timeOut: null,
			workedMinutes: 0,
			lateMinutes: 0,
			undertimeMinutes: 0,
			remarks: '',
			kind: s?.isRestDay ? ('rest' as const) : ('empty' as const),
			manual: false
		};
	});

	return {
		days,
		totals: {
			workedMinutes: days.reduce((n, d) => n + d.workedMinutes, 0),
			lateMinutes: days.reduce((n, d) => n + d.lateMinutes, 0),
			undertimeMinutes: days.reduce((n, d) => n + d.undertimeMinutes, 0),
			absentDays: days.filter((d) => d.kind === 'absent').length,
			workedDays: days.filter((d) => d.kind === 'work').length
		}
	};
}
