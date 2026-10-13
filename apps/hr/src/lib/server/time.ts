/** Timezone helpers HR needs. Copied (not imported) from the hotel app: this app must not depend
 *  on hotel modules, and the originals sat inside finance/front-desk/cancellation files that drag
 *  in payments and folios (docs/HR_PLAN.md §11). */

/** Today's date (`YYYY-MM-DD`) in an establishment's own timezone — its "business date". */
export function businessDateFor(timezone: string): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}

export const todayInTimezone = businessDateFor;

/** Convert a wall-clock `date` + `time` in `timeZone` to a UTC epoch (ms). PH has no DST;
 *  a single offset pass is exact there and close enough everywhere else this app runs. */
export function wallTimeToUtcMs(dateStr: string, timeStr: string, timeZone: string): number {
	const [y, mo, d] = dateStr.split('-').map(Number);
	const [h, mi, s] = timeStr.split(':').map((n) => Number(n) || 0);
	const guess = Date.UTC(y!, mo! - 1, d!, h!, mi!, s!);
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	}).formatToParts(new Date(guess));
	const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
	const hour = get('hour') % 24;
	const asWall = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		hour,
		get('minute'),
		get('second')
	);
	return guess - (asWall - guess);
}
