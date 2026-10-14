/**
 * Pure rules for the biometric → DTR import: delimited-text parsing, wall-clock datetime
 * parsing, punch clustering and the worked/OT/night-diff/tardy/undertime maths. No DB and no
 * server-local time zone — instants are epoch ms and `YYYY-MM-DD` dates are the establishment's
 * business date, resolved by the caller (see `server/hr/dtr-import.ts`).
 */
import { timeToMinutes } from './roster';

export const DATE_FORMATS = ['auto', 'ymd', 'mdy', 'dmy'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** Two taps this close together are one punch (a double-tap on the reader). */
export const DUPLICATE_PUNCH_MINUTES = 2;
/** A longer silence than this starts a new shift. */
export const SHIFT_GAP_MINUTES = 12 * 60;
/** A single record longer than this is surfaced as suspicious (missed out-punch, usually). */
export const LONG_SHIFT_MINUTES = 16 * 60;
/** After the break-in, a punch this much later is the clock-out; any closer is a re-tap. */
export const MIN_STINT_AFTER_BREAK_MINUTES = 60;
export const DEFAULT_NIGHT_WINDOW = { start: '22:00', end: '06:00' } as const;

// ---------------------------------------------------------------------------
// Delimited text
// ---------------------------------------------------------------------------

/** Tab beats comma beats semicolon — the delimiter that splits the first lines most consistently. */
export function detectDelimiter(text: string): string {
	const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 10);
	let best = '\t';
	let bestScore = 0;
	for (const d of ['\t', ',', ';', '|']) {
		const counts = lines.map((l) => l.split(d).length - 1);
		const min = Math.min(...counts);
		if (lines.length > 0 && min > 0 && min * lines.length > bestScore) {
			best = d;
			bestScore = min * lines.length;
		}
	}
	// A single-column file has no delimiter at all; fall back to splitting on whitespace later.
	return bestScore === 0 ? ' ' : best;
}

/** Minimal RFC-4180-ish splitter: handles quoted cells and doubled quotes. */
function splitLine(line: string, delimiter: string): string[] {
	if (delimiter === ' ') return line.trim().split(/\s{2,}|\t/);
	const cells: string[] = [];
	let cur = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i]!;
		if (quoted) {
			if (ch === '"' && line[i + 1] === '"') {
				cur += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else cur += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === delimiter) {
			cells.push(cur);
			cur = '';
		} else cur += ch;
	}
	cells.push(cur);
	return cells;
}

export function parseDelimited(text: string): string[][] {
	const clean = text.replace(/^﻿/, '');
	const delimiter = detectDelimiter(clean);
	return clean
		.split(/\r?\n/)
		.filter((l) => l.trim() !== '')
		.map((l) => splitLine(l, delimiter).map((c) => c.trim()));
}

// ---------------------------------------------------------------------------
// Datetime
// ---------------------------------------------------------------------------

export type WallDateTime = { date: string; time: string };

const pad = (n: number) => String(n).padStart(2, '0');

function validYmd(y: number, m: number, d: number): boolean {
	if (m < 1 || m > 12 || d < 1) return false;
	return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Reads a wall-clock `date time` string as exported by a biometric reader/spreadsheet.
 * Accepts `2026-10-09 07:58[:ss]`, `10/9/2026 7:58[:ss] AM`, `09.10.2026 07:58`, with an
 * ISO `T` separator too. `auto` reads year-first as ISO and otherwise month-first (the
 * common export), so a day-first file needs `dmy` chosen explicitly. Returns null if unparseable.
 */
export function parseWallDateTime(raw: string, format: DateFormat = 'auto'): WallDateTime | null {
	const s = raw.trim().replace(/\s+/g, ' ');
	const m =
		/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?)?Z?$/.exec(
			s
		);
	if (!m) return null;
	const a = Number(m[1]);
	const b = Number(m[2]);
	const c = Number(m[3]);
	let y: number, mo: number, d: number;
	const yearFirst = m[1]!.length === 4;
	const effective: DateFormat = format === 'auto' ? (yearFirst ? 'ymd' : 'mdy') : format;
	if (effective === 'ymd') {
		if (!yearFirst) return null;
		[y, mo, d] = [a, b, c];
	} else {
		if (m[3]!.length !== 4 && m[3]!.length !== 2) return null;
		y = c < 100 ? 2000 + c : c;
		[mo, d] = effective === 'mdy' ? [a, b] : [b, a];
	}
	if (!validYmd(y, mo, d)) return null;

	let h = m[4] === undefined ? 0 : Number(m[4]);
	const min = m[5] === undefined ? 0 : Number(m[5]);
	const sec = m[6] === undefined ? 0 : Number(m[6]);
	if (m[7]) {
		if (h < 1 || h > 12) return null;
		const pm = m[7].toLowerCase() === 'pm';
		h = (h % 12) + (pm ? 12 : 0);
	}
	if (h > 23 || min > 59 || sec > 59) return null;
	return { date: `${y}-${pad(mo)}-${pad(d)}`, time: `${pad(h)}:${pad(min)}:${pad(sec)}` };
}

/** Biometric ids often arrive as `0042`, `42`, or `42.0` (spreadsheets) — compare on one form. */
export function normalizeEnrollId(raw: string): string {
	const t = raw.trim();
	const num = /^0*(\d+)(?:\.0+)?$/.exec(t);
	return num ? num[1]! : t.toLowerCase();
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

export type Cluster = {
	/** Epoch ms of the first / last punch (`outMs` null for a lone punch). */
	inMs: number;
	outMs: number | null;
	punchCount: number;
	/** Every punch of the shift, de-duplicated and ascending. */
	punches: number[];
};

/** A long silence that ends within this of a rostered start is the next shift beginning, not a long break. */
export const NEW_SHIFT_START_WINDOW_MINUTES = 3 * 60;
/** Only a silence at least this long can be a gap between two shifts when the roster says one starts. */
export const MIN_GAP_BETWEEN_SHIFTS_MINUTES = 6 * 60;
/** A day that began at a rostered start stays one shift across a silence up to this (a 13h day of overtime). */
export const SHIFT_GAP_WITH_ROSTER_MINUTES = 16 * 60;

/**
 * Sorts one employee's punch instants and splits them into shifts (first = in, last = out). A silence
 * over 12h starts a new shift (16h when the roster is known, so a 13h day of overtime stays whole).
 * With `scheduledStarts` (epoch ms of their rostered shift starts), a silence of 6h or more also starts
 * a new shift when the next punch lands within 3h of a different rostered start, so overtime until
 * 9 PM followed by an 8 AM clock-in is two days, not one.
 */
export function clusterPunches(instantsMs: number[], scheduledStarts: number[] = []): Cluster[] {
	const sorted = [...instantsMs].sort((x, y) => x - y);
	const deduped: number[] = [];
	for (const t of sorted) {
		const prev = deduped.at(-1);
		if (prev === undefined || t - prev > DUPLICATE_PUNCH_MINUTES * 60_000) deduped.push(t);
	}
	/** The rostered start this punch is closest to (within the window), or null. */
	const nearestStart = (t: number): number | null => {
		let best: number | null = null;
		for (const s of scheduledStarts) {
			if (Math.abs(t - s) <= NEW_SHIFT_START_WINDOW_MINUTES * 60_000 && (best === null || Math.abs(t - s) < Math.abs(t - best))) best = s;
		}
		return best;
	};
	const groups: number[][] = [];
	for (const t of deduped) {
		const g = groups.at(-1);
		const last = g?.at(-1);
		const gap = last === undefined ? 0 : t - last;
		// A long day of overtime with only in/out taps: it began at a rostered start and the next punch
		// is not the start of another shift, so a silence up to 16h is still the same day.
		const longDay =
			last !== undefined &&
			gap <= SHIFT_GAP_WITH_ROSTER_MINUTES * 60_000 &&
			nearestStart(g![0]!) !== null &&
			nearestStart(t) === null;
		const newShift =
			last !== undefined &&
			((gap > SHIFT_GAP_MINUTES * 60_000 && !longDay) ||
				(gap >= MIN_GAP_BETWEEN_SHIFTS_MINUTES * 60_000 &&
					nearestStart(t) !== null &&
					nearestStart(t) !== nearestStart(g![0]!)));
		if (g && !newShift) g.push(t);
		else groups.push([t]);
	}
	return groups.map((g) => ({
		inMs: g[0]!,
		outMs: g.length > 1 ? g.at(-1)! : null,
		punchCount: g.length,
		punches: g
	}));
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export type ScheduleInput = {
	isRestDay: boolean;
	/** Epoch ms of the scheduled start/end on the record's date (end rolled to next day if overnight). */
	startMs: number | null;
	endMs: number | null;
	breakMinutes: number;
	/** Split shift: the scheduled break window on the record's date. */
	breakStartMs?: number | null;
	breakEndMs?: number | null;
};

export type DtrMetrics = {
	workedMinutes: number;
	otMinutes: number;
	nightDiffMinutes: number;
	tardinessMinutes: number;
	undertimeMinutes: number;
};

export type DtrFlag =
	| 'single_punch'
	| 'no_schedule'
	| 'rest_day'
	| 'long_shift'
	| 'missing_break_out'
	| 'missing_break_in'
	| 'no_return'
	| 'missing_out'
	| 'missing_in';

const minutesBetween = (fromMs: number, toMs: number) => Math.round((toMs - fromMs) / 60_000);

function overlapMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
	const lo = Math.max(aStart, bStart);
	const hi = Math.min(aEnd, bEnd);
	return hi > lo ? minutesBetween(lo, hi) : 0;
}

export type SplitSlots = {
	inMs: number;
	breakOutMs: number | null;
	breakInMs: number | null;
	outMs: number | null;
};

/**
 * Assigns a split-shift day's punches to in / break-out / break-in / out. The first punch is
 * always "in". Every later punch goes by where it falls: before the middle of the break it is
 * a break-out, between there and the middle of the second part it is a break-in, and after
 * that it is the clock-out. Within a slot the earliest wins (a re-tap never lengthens a break),
 * except the clock-out, which is the latest.
 */
export function assignSplitPunches(
	punches: number[],
	breakStartMs: number,
	breakEndMs: number,
	endMs: number
): SplitSlots {
	const midBreak = (breakStartMs + breakEndMs) / 2;
	const midSecond = (breakEndMs + endMs) / 2;
	const slots: SplitSlots = { inMs: punches[0]!, breakOutMs: null, breakInMs: null, outMs: null };
	for (const t of punches.slice(1)) {
		if (t < midBreak) slots.breakOutMs ??= t;
		else if (t < midSecond) {
			if (slots.breakInMs === null) slots.breakInMs = t;
			// A re-tap right after coming back is ignored; a punch an hour or more later is the clock-out.
			else if (t - slots.breakInMs >= MIN_STINT_AFTER_BREAK_MINUTES * 60_000) slots.outMs = t;
		} else slots.outMs = t;
	}
	return slots;
}

function computeSplitMetrics(
	cluster: Cluster,
	schedule: ScheduleInput & { breakStartMs: number; breakEndMs: number },
	nightWindows: Array<[number, number]>
): { metrics: DtrMetrics; flags: DtrFlag[]; slots: SplitSlots } {
	const flags: DtrFlag[] = [];
	const slots = assignSplitPunches(
		cluster.punches,
		schedule.breakStartMs,
		schedule.breakEndMs,
		schedule.endMs!
	);
	const { breakStartMs: bs, breakEndMs: be } = schedule;
	const scheduledBreak = minutesBetween(bs, be);
	const { inMs, breakOutMs, breakInMs, outMs } = slots;

	// Time actually worked, and the interval that is *not* worked (for night differential).
	let worked: number;
	let notWorked: [number, number] | null = null;
	// Back from lunch but never clocked out: the afternoon cannot be proven, so it is not paid.
	let afternoonUnproven = false;
	if (outMs === null) {
		if (breakOutMs !== null) {
			if (breakInMs === null) {
				flags.push('no_return');
			} else {
				flags.push('missing_out');
				afternoonUnproven = true;
			}
			worked = minutesBetween(inMs, breakOutMs);
		} else if (breakInMs !== null) {
			flags.push('missing_out');
			afternoonUnproven = true;
			worked = Math.max(0, minutesBetween(inMs, breakInMs) - scheduledBreak);
			notWorked = [bs, be];
		} else {
			flags.push('single_punch');
			if (inMs > (schedule.startMs! + schedule.endMs!) / 2) flags.push('missing_in');
			worked = 0;
		}
	} else if (breakOutMs !== null && breakInMs !== null) {
		worked = minutesBetween(inMs, breakOutMs) + minutesBetween(breakInMs, outMs);
		notWorked = [breakOutMs, breakInMs];
	} else {
		// One or both middle punches are missing, but the clock-out proves they came back:
		// assume the break ran as scheduled (only the part that fell inside the stint) and say so.
		if (breakOutMs !== null || breakInMs !== null) {
			flags.push(breakOutMs === null ? 'missing_break_out' : 'missing_break_in');
		}
		worked = Math.max(0, minutesBetween(inMs, outMs) - overlapMinutes(inMs, outMs, bs, be));
		notWorked = [bs, be];
	}

	const lastMs = outMs ?? breakInMs ?? breakOutMs ?? inMs;
	if (minutesBetween(inMs, lastMs) > LONG_SHIFT_MINUTES) flags.push('long_shift');

	const nightDiff = nightWindows.reduce((sum, [s, e]) => {
		let n = overlapMinutes(inMs, lastMs, s, e);
		if (notWorked) {
			const lo = Math.max(inMs, notWorked[0]);
			const hi = Math.min(lastMs, notWorked[1]);
			if (hi > lo) n -= overlapMinutes(lo, hi, s, e);
		}
		return sum + Math.max(0, n);
	}, 0);

	// A lone punch is never "late": there is nothing to measure it against. Lateness excludes the
	// scheduled break, which is unpaid time and not missed work.
	const alone = flags.includes('single_punch');
	const lateFromBreak =
		breakInMs !== null && outMs !== null ? Math.max(0, minutesBetween(be, breakInMs)) : 0;
	const tardiness = alone
		? 0
		: Math.max(0, minutesBetween(schedule.startMs!, inMs) - overlapMinutes(schedule.startMs!, inMs, bs, be)) +
			lateFromBreak;

	let undertime = 0;
	let ot = 0;
	if (outMs !== null) {
		ot = Math.max(0, minutesBetween(schedule.endMs!, outMs));
		undertime = Math.max(
			0,
			minutesBetween(outMs, schedule.endMs!) - overlapMinutes(outMs, schedule.endMs!, bs, be)
		);
	} else if (breakOutMs !== null && breakInMs === null) {
		// Left at lunch and never came back: the rest of the scheduled day is unworked.
		undertime = Math.max(0, minutesBetween(breakOutMs, schedule.endMs!) - scheduledBreak);
	} else if (afternoonUnproven) {
		undertime = Math.max(0, minutesBetween(be, schedule.endMs!));
	}

	return {
		metrics: {
			workedMinutes: worked,
			otMinutes: ot,
			nightDiffMinutes: nightDiff,
			tardinessMinutes: tardiness,
			undertimeMinutes: undertime
		},
		flags,
		slots
	};
}

/**
 * Computes a record's minutes. `nightWindows` are the absolute `[startMs, endMs]` night-diff
 * intervals that could touch the shift (the caller builds them from the window and zone).
 * Without a schedule, only worked + night-diff are known — late/undertime/OT stay 0 and the
 * record is flagged so HR can review it.
 */
export function computeMetrics(
	cluster: Cluster,
	schedule: ScheduleInput | null,
	nightWindows: Array<[number, number]>
): { metrics: DtrMetrics; flags: DtrFlag[]; slots?: SplitSlots } {
	const flags: DtrFlag[] = [];
	const zero: DtrMetrics = {
		workedMinutes: 0,
		otMinutes: 0,
		nightDiffMinutes: 0,
		tardinessMinutes: 0,
		undertimeMinutes: 0
	};
	const split =
		schedule &&
		!schedule.isRestDay &&
		schedule.startMs != null &&
		schedule.endMs != null &&
		schedule.breakStartMs != null &&
		schedule.breakEndMs != null;
	if (split) {
		return computeSplitMetrics(
			cluster,
			schedule as ScheduleInput & { breakStartMs: number; breakEndMs: number },
			nightWindows
		);
	}

	const working = schedule && !schedule.isRestDay && schedule.startMs != null && schedule.endMs != null;

	if (cluster.outMs === null) {
		flags.push('single_punch');
		if (!schedule) flags.push('no_schedule');
		else if (working && cluster.inMs > (schedule.startMs! + schedule.endMs!) / 2) flags.push('missing_in');
		return { metrics: zero, flags };
	}

	const span = minutesBetween(cluster.inMs, cluster.outMs);
	if (span > LONG_SHIFT_MINUTES) flags.push('long_shift');

	if (!schedule) flags.push('no_schedule');
	else if (schedule.isRestDay) flags.push('rest_day');

	// Without a break window the unpaid break is taken to sit in the middle of the shift; it is only
	// deducted for the part that fell inside the time actually worked.
	const breakMinutes = schedule?.breakMinutes ?? 0;
	let breakWin: [number, number] | null = null;
	if (working && breakMinutes > 0) {
		const mid = (schedule!.startMs! + schedule!.endMs!) / 2;
		breakWin = [mid - (breakMinutes * 60_000) / 2, mid + (breakMinutes * 60_000) / 2];
	}
	const inBreak = (a: number, b: number) => (breakWin ? overlapMinutes(a, b, breakWin[0], breakWin[1]) : 0);
	// A short stint (e.g. half-day) never goes negative because of the scheduled break.
	const worked = breakWin ? span - inBreak(cluster.inMs, cluster.outMs) : span > breakMinutes ? span - breakMinutes : span;

	const nightDiff = nightWindows.reduce(
		(sum, [s, e]) => sum + overlapMinutes(cluster.inMs, cluster.outMs!, s, e),
		0
	);

	if (!working) {
		return { metrics: { ...zero, workedMinutes: worked, nightDiffMinutes: nightDiff }, flags };
	}
	return {
		metrics: {
			workedMinutes: worked,
			otMinutes: Math.max(0, minutesBetween(schedule!.endMs!, cluster.outMs)),
			nightDiffMinutes: nightDiff,
			tardinessMinutes: Math.max(
				0,
				minutesBetween(schedule!.startMs!, cluster.inMs) - inBreak(schedule!.startMs!, cluster.inMs)
			),
			undertimeMinutes: Math.max(
				0,
				minutesBetween(cluster.outMs, schedule!.endMs!) - inBreak(cluster.outMs, schedule!.endMs!)
			)
		},
		flags
	};
}

export type CreditMetrics = { worked: number; late: number; under: number; ot: number; night: number };

/**
 * How approved leave and a holiday/memo change a day's minutes, once the punches are measured.
 * Whole-day leave replaces the day; a half day excuses lateness and undertime up to half the
 * shift and (when paid) credits that half; a holiday/memo credits the day (or its set hours)
 * and, if it waives lateness, clears late and undertime. Pure: used by the DTR and the scenarios.
 */
export function applyCredits(
	m: CreditMetrics,
	scheduledMinutes: number,
	leave: { paid: boolean; halfDay: 'am' | 'pm' | null } | null,
	calendar: { creditMinutes: number | null; waiveLateness: boolean } | null,
	punched: boolean
): CreditMetrics & { leaveMinutes: number; clearPunches: boolean } {
	if (leave && !leave.halfDay) {
		const credit = leave.paid ? scheduledMinutes : 0;
		return { worked: credit, late: 0, under: 0, ot: 0, night: 0, leaveMinutes: credit, clearPunches: true };
	}
	if (leave) {
		const half = Math.round(scheduledMinutes / 2);
		return {
			...m,
			late: Math.max(0, m.late - half),
			under: Math.max(0, m.under - half),
			worked: leave.paid ? Math.min(scheduledMinutes, m.worked + half) : m.worked,
			leaveMinutes: leave.paid ? half : 0,
			clearPunches: false
		};
	}
	if (calendar) {
		const credit = calendar.creditMinutes ?? scheduledMinutes;
		const waived = calendar.waiveLateness;
		return {
			...m,
			worked: Math.max(m.worked, credit),
			late: waived ? 0 : m.late,
			under: waived ? 0 : m.under,
			leaveMinutes: 0,
			clearPunches: false
		};
	}
	void punched;
	return { ...m, leaveMinutes: 0, clearPunches: false };
}

/**
 * Once leave or a memo has excused all the undertime, "no return / no clock-out" is no longer a
 * problem to chase: the half of the day it described is covered.
 */
export function flagsAfterCredit(flags: DtrFlag[], undertimeBefore: number, undertimeAfter: number): DtrFlag[] {
	if (undertimeBefore > 0 && undertimeAfter === 0) {
		return flags.filter((f) => f !== 'no_return' && f !== 'missing_out');
	}
	return flags;
}

/** `HH:MM` pair → `{startMin, spansNextDay}` helper for building night windows. */
export function nightWindowParts(window: { start: string; end: string } | null | undefined) {
	const w = window ?? DEFAULT_NIGHT_WINDOW;
	const start = timeToMinutes(w.start) ?? 22 * 60;
	const end = timeToMinutes(w.end) ?? 6 * 60;
	return { start, end, overnight: end <= start };
}

const FLAG_REMARK: Partial<Record<DtrFlag, string>> = {
	single_punch: 'One punch only',
	no_schedule: 'No schedule',
	long_shift: 'Check out-punch',
	missing_break_out: 'No break-out punch',
	missing_break_in: 'No break-in punch',
	no_return: 'No return from break',
	missing_out: 'No clock-out punch',
	missing_in: 'No clock-in punch'
};

/** The line printed in a DTR day's remarks: what looks off, and whether staff added a punch. */
export function dayRemarks(flags: DtrFlag[], manualPunch: boolean): string {
	const parts = flags.map((f) => FLAG_REMARK[f]).filter((r): r is string => !!r);
	if (manualPunch) parts.push('Time added by staff');
	return parts.join(', ');
}

/** The remarks line for one generated day: absent, leave, holiday/memo, or what looks off. */
export function recordRemarks(r: {
	isAbsent: boolean;
	flags: DtrFlag[];
	manualPunch: boolean;
	timeIn: number | null;
	leave: { code: string; name: string; halfDay: 'am' | 'pm' | null } | null;
	calendar: { name: string } | null;
}): string {
	if (r.leave) {
		const half = r.leave.halfDay ? ` (half day ${r.leave.halfDay.toUpperCase()})` : '';
		const base = `${r.leave.code} – ${r.leave.name}${half}`;
		if (r.timeIn === null && r.leave.halfDay) return `${base}; other half has no punches`;
		const extra = dayRemarks(r.flags, r.manualPunch);
		return extra ? `${base}; ${extra}` : base;
	}
	if (r.calendar) {
		const extra = dayRemarks(r.flags, r.manualPunch);
		return extra ? `${r.calendar.name}; ${extra}` : r.calendar.name;
	}
	return r.isAbsent ? 'Absent' : dayRemarks(r.flags, r.manualPunch);
}
