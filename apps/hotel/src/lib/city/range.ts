/** Shared date-range handling for city reports (presets, custom range, month helpers). Pure. */

export const RANGE_PRESETS = ['last-12', 'ytd', 'this-month', 'last-month', 'last-3', 'custom'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_LABEL: Record<RangePreset, string> = {
	'last-12': 'Last 12 months',
	ytd: 'This year',
	'this-month': 'This month',
	'last-month': 'Last month',
	'last-3': 'Last 3 months',
	custom: 'Custom'
};

export const MAX_RANGE_MONTHS = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function parseDate(s: string | null | undefined): Date | null {
	if (!s || !DATE_RE.test(s)) return null;
	const d = new Date(`${s}T00:00:00Z`);
	return Number.isNaN(d.getTime()) || ymd(d) !== s ? null : d;
}

const firstOfMonth = (d: Date, monthOffset = 0) =>
	new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthOffset, 1));
const lastOfMonth = (d: Date, monthOffset = 0) =>
	new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthOffset + 1, 0));

export const monthOf = (date: string) => date.slice(0, 7);

/** Number of calendar months touched by [from, to]. */
export function monthSpan(from: string, to: string): number {
	const [fy, fm] = from.split('-').map(Number) as [number, number];
	const [ty, tm] = to.split('-').map(Number) as [number, number];
	return (ty - fy) * 12 + (tm - fm) + 1;
}

/** Every `YYYY-MM` from `from`'s month through `to`'s month, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
	const out: string[] = [];
	const [fy, fm] = from.split('-').map(Number) as [number, number];
	const n = monthSpan(from, to);
	for (let i = 0; i < n; i++) {
		const d = new Date(Date.UTC(fy, fm - 1 + i, 1));
		out.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
	}
	return out;
}

export type ResolvedRange = {
	preset: RangePreset;
	from: string;
	to: string;
	/** Set when a custom range was rejected and the default was used instead. */
	error: string | null;
};

/** `today` is a `YYYY-MM-DD` business date (the city uses Manila time). */
export function resolveRange(
	params: { range?: string | null; from?: string | null; to?: string | null },
	today: string
): ResolvedRange {
	const t = parseDate(today)!;
	const presetRange = (preset: Exclude<RangePreset, 'custom'>): ResolvedRange => {
		switch (preset) {
			case 'this-month':
				return { preset, from: ymd(firstOfMonth(t)), to: today, error: null };
			case 'last-month':
				return { preset, from: ymd(firstOfMonth(t, -1)), to: ymd(lastOfMonth(t, -1)), error: null };
			case 'last-3':
				return { preset, from: ymd(firstOfMonth(t, -2)), to: today, error: null };
			case 'ytd':
				return { preset, from: `${t.getUTCFullYear()}-01-01`, to: today, error: null };
			case 'last-12':
				return { preset, from: ymd(firstOfMonth(t, -11)), to: today, error: null };
		}
	};

	if (params.range === 'custom' || (!params.range && (params.from || params.to))) {
		const from = parseDate(params.from);
		const to = parseDate(params.to);
		const fallback = { ...presetRange('last-12') };
		if (!from || !to) return { ...fallback, error: 'Enter both dates as valid dates.' };
		if (ymd(from) > ymd(to)) return { ...fallback, error: 'The start date must be on or before the end date.' };
		if (monthSpan(ymd(from), ymd(to)) > MAX_RANGE_MONTHS) {
			return { ...fallback, error: `Choose a range of ${MAX_RANGE_MONTHS / 12} years or less.` };
		}
		return { preset: 'custom', from: ymd(from), to: ymd(to), error: null };
	}

	const preset = (RANGE_PRESETS as readonly string[]).includes(params.range ?? '')
		? (params.range as Exclude<RangePreset, 'custom'>)
		: 'last-12';
	return presetRange(preset);
}

