/**
 * Pure rules for the biometric → DTR import: delimited-text parsing, wall-clock datetime
 * parsing, punch clustering and the worked/OT/night-diff/tardy/undertime maths. No DB and no
 * server-local time zone — instants are epoch ms and `YYYY-MM-DD` dates are the hotel's
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

/** Sorts one employee's punch instants and splits them into shifts (first = in, last = out). */
export function clusterPunches(instantsMs: number[]): Cluster[] {
	const sorted = [...instantsMs].sort((x, y) => x - y);
	const deduped: number[] = [];
	for (const t of sorted) {
		const prev = deduped.at(-1);
		if (prev === undefined || t - prev > DUPLICATE_PUNCH_MINUTES * 60_000) deduped.push(t);
	}
	const groups: number[][] = [];
	for (const t of deduped) {
		const g = groups.at(-1);
		if (g && t - g.at(-1)! <= SHIFT_GAP_MINUTES * 60_000) g.push(t);
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
	| 'missing_out';

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
		else if (t < midSecond) slots.breakInMs ??= t;
		else slots.outMs = t;
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
	const scheduledBreak = minutesBetween(schedule.breakStartMs, schedule.breakEndMs);
	const { inMs, breakOutMs, breakInMs, outMs } = slots;

	// Time actually worked, and the interval that is *not* worked (for night differential).
	let worked: number;
	let notWorked: [number, number] | null = null;
	if (outMs === null) {
		if (breakOutMs !== null) {
			flags.push(breakInMs === null ? 'no_return' : 'missing_out');
			worked = minutesBetween(inMs, breakOutMs);
		} else if (breakInMs !== null) {
			flags.push('missing_out');
			worked = Math.max(0, minutesBetween(inMs, breakInMs) - scheduledBreak);
			notWorked = [schedule.breakStartMs, schedule.breakEndMs];
		} else {
			flags.push('single_punch');
			worked = 0;
		}
	} else if (breakOutMs !== null && breakInMs !== null) {
		worked = minutesBetween(inMs, breakOutMs) + minutesBetween(breakInMs, outMs);
		notWorked = [breakOutMs, breakInMs];
	} else {
		// One or both middle punches are missing, but the clock-out proves they came back:
		// assume the break ran as scheduled and say so.
		if (breakOutMs === null && breakInMs === null) {
			// Worked straight through (or never tapped for lunch): pay the scheduled break as usual.
		} else {
			flags.push(breakOutMs === null ? 'missing_break_out' : 'missing_break_in');
		}
		worked = Math.max(0, minutesBetween(inMs, outMs) - scheduledBreak);
		notWorked = [schedule.breakStartMs, schedule.breakEndMs];
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

	// Late back from lunch counts as tardiness too, but only when both ends of the break were tapped.
	const lateFromBreak =
		breakInMs !== null && outMs !== null ? Math.max(0, minutesBetween(schedule.breakEndMs, breakInMs)) : 0;
	const tardiness = Math.max(0, minutesBetween(schedule.startMs!, inMs)) + lateFromBreak;

	let undertime = 0;
	let ot = 0;
	if (outMs !== null) {
		ot = Math.max(0, minutesBetween(schedule.endMs!, outMs));
		undertime = Math.max(0, minutesBetween(outMs, schedule.endMs!));
	} else if (breakOutMs !== null && breakInMs === null) {
		// Left at lunch and never came back: the rest of the scheduled day is unworked.
		undertime = Math.max(0, minutesBetween(breakOutMs, schedule.endMs!) - scheduledBreak);
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

	if (cluster.outMs === null) {
		flags.push('single_punch');
		if (!schedule) flags.push('no_schedule');
		return { metrics: zero, flags };
	}

	const span = minutesBetween(cluster.inMs, cluster.outMs);
	if (span > LONG_SHIFT_MINUTES) flags.push('long_shift');

	const working = schedule && !schedule.isRestDay && schedule.startMs !== null && schedule.endMs !== null;
	if (!schedule) flags.push('no_schedule');
	else if (schedule.isRestDay) flags.push('rest_day');

	const breakMinutes = schedule?.breakMinutes ?? 0;
	// A short stint (e.g. half-day) never goes negative because of the scheduled break.
	const worked = span > breakMinutes ? span - breakMinutes : span;

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
			tardinessMinutes: Math.max(0, minutesBetween(schedule!.startMs!, cluster.inMs)),
			undertimeMinutes: Math.max(0, minutesBetween(cluster.outMs, schedule!.endMs!))
		},
		flags
	};
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
	missing_out: 'No clock-out punch'
};

/** The line printed in a DTR day's remarks: what looks off, and whether staff added a punch. */
export function dayRemarks(flags: DtrFlag[], manualPunch: boolean): string {
	const parts = flags.map((f) => FLAG_REMARK[f]).filter((r): r is string => !!r);
	if (manualPunch) parts.push('Time added by staff');
	return parts.join(', ');
}
