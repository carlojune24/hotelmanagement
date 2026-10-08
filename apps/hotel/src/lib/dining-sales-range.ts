const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `date` plus `n` days, as `YYYY-MM-DD` (calendar arithmetic, no timezone involved). */
export const addDays = (date: string, n: number) => {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
};

/** Resolves ?from & ?to (business dates), defaulting to today and never reversed. */
export function resolveRange(url: URL, today: string): { from: string; to: string } {
	const f = url.searchParams.get('from') ?? '';
	const t = url.searchParams.get('to') ?? '';
	let from = DATE_RE.test(f) ? f : today;
	let to = DATE_RE.test(t) ? t : from;
	if (to < from) [from, to] = [to, from];
	return { from, to };
}
