/** Date-range presets for the staff list pages. All dates are `YYYY-MM-DD` in the hotel's own
 *  timezone (callers pass `today` already resolved from it), so nothing here touches the clock. */

export type RangePreset = 'today' | 'week' | 'month' | 'custom';

export interface ResolvedRange {
	preset: RangePreset;
	from: string;
	to: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Today, this week (Monday–Sunday), this month, or a custom `from`–`to` (swapped if reversed;
 *  an invalid custom range falls back to today). */
export function resolveRange(
	preset: string | null | undefined,
	from: string | null | undefined,
	to: string | null | undefined,
	today: string
): ResolvedRange {
	if (preset === 'week') {
		const d = parse(today);
		const monday = new Date(d);
		monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
		const sunday = new Date(monday);
		sunday.setUTCDate(monday.getUTCDate() + 6);
		return { preset: 'week', from: iso(monday), to: iso(sunday) };
	}
	if (preset === 'month') {
		const d = parse(today);
		const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
		const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
		return { preset: 'month', from: iso(first), to: iso(last) };
	}
	if (preset === 'custom' && isDate(from) && isDate(to)) {
		return from <= to
			? { preset: 'custom', from, to }
			: { preset: 'custom', from: to, to: from };
	}
	return { preset: 'today', from: today, to: today };
}
