/**
 * Pure roster rules shared by the HR schedule page and its server actions — week maths,
 * shift duration, and the "worth a second look" warnings. No DB, no Date-in-local-time:
 * dates are `YYYY-MM-DD` strings (a hotel's business date, see `todayInTimezone`) and all
 * arithmetic is done in UTC on those strings so a server or browser timezone can never
 * shift a day.
 */

export const MINUTES_PER_DAY = 24 * 60;
/** Weekly-hours warning threshold. A constant for now; Philippine regular hours are 48/week. */
export const WEEKLY_HOURS_WARNING_MINUTES = 48 * 60;

export const TEMPLATE_TAGS = ['neutral', 'brand', 'ok', 'warning'] as const;
export type TemplateTag = (typeof TEMPLATE_TAGS)[number];

/** `HH:MM` or Postgres's `HH:MM:SS` → minutes since midnight; null if unparseable/unset. */
export function timeToMinutes(t: string | null | undefined): number | null {
	if (!t) return null;
	const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(t);
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return null;
	return h * 60 + min;
}

/** Trims Postgres's `HH:MM:SS` to the `HH:MM` the forms and templates use. */
export function toHHMM(t: string | null | undefined): string | null {
	const mins = timeToMinutes(t);
	if (mins === null) return null;
	return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** `endTime < startTime` means the shift ends the next day. Equal/missing times span 0. */
export function shiftSpanMinutes(
	start: string | null | undefined,
	end: string | null | undefined
): number {
	const s = timeToMinutes(start);
	const e = timeToMinutes(end);
	if (s === null || e === null || s === e) return 0;
	return e > s ? e - s : e + MINUTES_PER_DAY - s;
}

export function crossesMidnight(
	start: string | null | undefined,
	end: string | null | undefined
): boolean {
	const s = timeToMinutes(start);
	const e = timeToMinutes(end);
	return s !== null && e !== null && e < s;
}

/** Paid minutes: the span minus the unpaid break, never negative. A rest day is always 0. */
export function netShiftMinutes(shift: {
	isRestDay: boolean;
	startTime: string | null | undefined;
	endTime: string | null | undefined;
	breakMinutes: number;
}): number {
	if (shift.isRestDay) return 0;
	return Math.max(0, shiftSpanMinutes(shift.startTime, shift.endTime) - shift.breakMinutes);
}

/**
 * A split shift (e.g. 08:00-12:00 + 13:00-17:00) is stored as its overall span plus the
 * unpaid break window between the parts, so span, paid minutes and overnight rules all
 * keep working. Returns an error message, or null when the window is valid.
 */
export function breakWindowError(
	start: string | null | undefined,
	end: string | null | undefined,
	breakStart: string | null | undefined,
	breakEnd: string | null | undefined
): string | null {
	const s = timeToMinutes(start);
	const e = timeToMinutes(end);
	const bs = timeToMinutes(breakStart);
	const be = timeToMinutes(breakEnd);
	if (s === null || e === null || bs === null || be === null) return 'Enter both break times.';
	if (e <= s) return 'A split shift has to end the same day it starts.';
	if (bs <= s) return 'The first part has to start before the break.';
	if (be <= bs) return 'The second part has to start after the first one ends.';
	if (be >= e) return 'The second part has to end after it starts.';
	return null;
}

/** The unpaid gap between the two parts, in minutes. */
export function breakWindowMinutes(
	breakStart: string | null | undefined,
	breakEnd: string | null | undefined
): number {
	const bs = timeToMinutes(breakStart);
	const be = timeToMinutes(breakEnd);
	return bs === null || be === null || be <= bs ? 0 : be - bs;
}

export function formatHours(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ---------------------------------------------------------------------------
// Dates (UTC arithmetic on YYYY-MM-DD strings)
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(s: string): boolean {
	if (!DATE_RE.test(s)) return false;
	return !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

export function addDays(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** The Monday on or before `date` — rosters are Monday-start. */
export function mondayOf(date: string): string {
	const d = new Date(`${date}T00:00:00Z`);
	return addDays(date, -((d.getUTCDay() + 6) % 7));
}

export function weekDates(weekStart: string): string[] {
	return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** First and last day of the month containing `date`. */
export function monthBounds(date: string): { start: string; end: string } {
	const [y = 0, m = 1] = date.split('-').map(Number);
	const start = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
	// Day 0 of the next month is the last day of this one.
	const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
	return { start, end };
}

/** Every date from `start` to `end`, inclusive. */
export function datesBetween(start: string, end: string): string[] {
	const out: string[] = [];
	for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
	return out;
}

// ---------------------------------------------------------------------------
// Shift codes — one short letter per distinct shift, for a 31-column printed month
// ---------------------------------------------------------------------------

export type CodedShift = {
	isRestDay: boolean;
	startTime: string | null;
	endTime: string | null;
	breakMinutes: number;
	/** Split shift only: the gap between the two parts. */
	breakStart?: string | null;
	breakEnd?: string | null;
};
export type CodeTemplate = CodedShift & { name: string };
export type ShiftLegendEntry = {
	code: string;
	label: string;
	shift: CodedShift;
};

/** Two shifts are "the same" for coding when rest-ness, times and break all match. */
export function sameShift(a: CodedShift, b: CodedShift): boolean {
	if (a.isRestDay || b.isRestDay) return a.isRestDay === b.isRestDay;
	return (
		a.startTime === b.startTime &&
		a.endTime === b.endTime &&
		a.breakMinutes === b.breakMinutes &&
		(a.breakStart ?? null) === (b.breakStart ?? null) &&
		(a.breakEnd ?? null) === (b.breakEnd ?? null)
	);
}

/**
 * Assigns a unique code to every distinct shift in `used`, preferring a saved template's
 * initial (Morning → M, Rest day → R). Two templates sharing an initial get M, M2; a
 * shift with no matching template is a one-off "custom" shift coded X, X2… and labelled
 * with its times, so the printed legend can always decode every cell.
 */
export function buildShiftLegend(
	used: CodedShift[],
	templates: CodeTemplate[]
): ShiftLegendEntry[] {
	const entries: ShiftLegendEntry[] = [];
	const taken = new Set<string>();
	const claim = (base: string) => {
		let code = base;
		for (let n = 2; taken.has(code); n++) code = `${base}${n}`;
		taken.add(code);
		return code;
	};

	const distinct: CodedShift[] = [];
	for (const s of used) if (!distinct.some((d) => sameShift(d, s))) distinct.push(s);

	// Templates first (in their saved order), so a template's initial is never pre-empted by a one-off.
	for (const t of templates) {
		const match = distinct.find((d) => sameShift(d, t));
		if (!match || entries.some((e) => sameShift(e.shift, match))) continue;
		const initial = (t.name.trim()[0] ?? 'S').toUpperCase();
		entries.push({ code: claim(initial), label: t.name, shift: match });
	}
	for (const s of distinct) {
		if (entries.some((e) => sameShift(e.shift, s))) continue;
		entries.push({ code: claim('X'), label: 'Custom hours', shift: s });
	}
	return entries;
}

export function codeFor(shift: CodedShift, legend: ShiftLegendEntry[]): string {
	return legend.find((e) => sameShift(e.shift, shift))?.code ?? '?';
}

// ---------------------------------------------------------------------------
// Warnings — advisory only, never blocking
// ---------------------------------------------------------------------------

export type RosterWarningKind = 'status' | 'weekly_hours' | 'overnight';

export type RosterWarning = {
	kind: RosterWarningKind;
	employeeId: string;
	/** Null for a whole-week warning (weekly hours). */
	date: string | null;
	/** `review` counts toward the header's "N to review"; `info` is shown on the cell only. */
	severity: 'review' | 'info';
	message: string;
};

export type RosterEmployee = { id: string; status: string };
export type RosterEntry = {
	employeeId: string;
	date: string;
	isRestDay: boolean;
	startTime: string | null;
	endTime: string | null;
	breakMinutes: number;
};

const STATUS_LABEL: Record<string, string> = {
	on_leave: 'is on leave',
	suspended: 'is suspended',
	separated: 'has separated'
};

export function computeRosterWarnings(input: {
	employees: RosterEmployee[];
	entries: RosterEntry[];
	thresholdMinutes?: number;
}): RosterWarning[] {
	const threshold = input.thresholdMinutes ?? WEEKLY_HOURS_WARNING_MINUTES;
	const statusByEmployee = new Map(input.employees.map((e) => [e.id, e.status]));
	const warnings: RosterWarning[] = [];
	const weekMinutes = new Map<string, number>();

	for (const e of input.entries) {
		if (e.isRestDay) continue;

		const status = statusByEmployee.get(e.employeeId);
		if (status && STATUS_LABEL[status]) {
			warnings.push({
				kind: 'status',
				employeeId: e.employeeId,
				date: e.date,
				severity: 'review',
				message: `Scheduled to work but ${STATUS_LABEL[status]}.`
			});
		}
		if (crossesMidnight(e.startTime, e.endTime)) {
			warnings.push({
				kind: 'overnight',
				employeeId: e.employeeId,
				date: e.date,
				severity: 'info',
				message: 'Shift ends the next day.'
			});
		}
		weekMinutes.set(e.employeeId, (weekMinutes.get(e.employeeId) ?? 0) + netShiftMinutes(e));
	}

	for (const [employeeId, minutes] of weekMinutes) {
		if (minutes > threshold) {
			warnings.push({
				kind: 'weekly_hours',
				employeeId,
				date: null,
				severity: 'review',
				message: `${formatHours(minutes)} this week — over ${formatHours(threshold)}.`
			});
		}
	}
	return warnings;
}
