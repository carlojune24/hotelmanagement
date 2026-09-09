/**
 * Date-range presets for the Finance dashboard. Pure string math on ISO
 * `YYYY-MM-DD` — "today" is already resolved from the hotel timezone by the
 * server, so nothing here touches `Date.now()` or local time.
 */

export type RangePresetKey =
	| 'today'
	| 'yesterday'
	| 'this_week'
	| 'this_month'
	| 'last_month'
	| 'custom';

export const RANGE_PRESETS: { key: Exclude<RangePresetKey, 'custom'>; label: string }[] = [
	{ key: 'today', label: 'Today' },
	{ key: 'yesterday', label: 'Yesterday' },
	{ key: 'this_week', label: 'This week' },
	{ key: 'this_month', label: 'This month' },
	{ key: 'last_month', label: 'Last month' }
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);

/** A well-formed *and real* calendar date (rejects e.g. 2026-13-40). */
export function isValidISO(s: string | null | undefined): s is string {
	if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	try {
		return iso(parse(s)) === s;
	} catch {
		return false;
	}
}

export function addDays(date: string, n: number): string {
	const d = parse(date);
	d.setUTCDate(d.getUTCDate() + n);
	return iso(d);
}

/** Monday-based start of the week containing `date`. */
export function startOfWeek(date: string): string {
	const d = parse(date);
	const dow = d.getUTCDay(); // 0=Sun … 6=Sat
	return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export const startOfMonth = (date: string) => `${date.slice(0, 7)}-01`;

export function endOfMonth(date: string): string {
	const d = parse(date);
	return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/** Resolve a preset to a `{ from, to }` pair against a given "today". */
export function resolveRange(key: RangePresetKey, today: string): { from: string; to: string } {
	switch (key) {
		case 'today':
			return { from: today, to: today };
		case 'yesterday': {
			const y = addDays(today, -1);
			return { from: y, to: y };
		}
		case 'this_week':
			return { from: startOfWeek(today), to: today };
		case 'this_month':
			return { from: startOfMonth(today), to: today };
		case 'last_month': {
			const lastMonthDay = addDays(startOfMonth(today), -1);
			return { from: startOfMonth(lastMonthDay), to: endOfMonth(lastMonthDay) };
		}
		default:
			return { from: today, to: today };
	}
}

/** Which preset (if any) a `{ from, to }` pair corresponds to, for highlighting. */
export function matchPreset(from: string, to: string, today: string): RangePresetKey {
	for (const { key } of RANGE_PRESETS) {
		const r = resolveRange(key, today);
		if (r.from === from && r.to === to) return key;
	}
	return 'custom';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "3 Sep 2026" — fixed format, no locale surprises. */
const fmtDay = (s: string) => {
	const [y, m, d] = s.split('-');
	return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};
const fmtDayNoYear = (s: string) => {
	const [, m, d] = s.split('-');
	return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
};

/** Human label for a resolved range, e.g. "Today", "This month", "26 Aug – 9 Sep 2026". */
export function rangeLabel(from: string, to: string, today: string): string {
	const preset = matchPreset(from, to, today);
	if (preset !== 'custom') return RANGE_PRESETS.find((p) => p.key === preset)!.label;
	if (from === to) return fmtDay(from);
	const sameYear = from.slice(0, 4) === to.slice(0, 4);
	return `${sameYear ? fmtDayNoYear(from) : fmtDay(from)} – ${fmtDay(to)}`;
}

/** Clamp a user-supplied range: valid ISO, from ≤ to, span ≤ 366 days. */
export function sanitizeRange(
	fromRaw: string | null,
	toRaw: string | null,
	today: string
): { from: string; to: string } {
	let from = isValidISO(fromRaw) ? fromRaw : today;
	let to = isValidISO(toRaw) ? toRaw : from;
	if (from > to) [from, to] = [to, from];
	if (addDays(from, 366) < to) from = addDays(to, -366);
	return { from, to };
}
