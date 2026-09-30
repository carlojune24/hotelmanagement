/** Guest-facing date + time wording for the booking screens. Pure. Dates are hotel-local
 *  YYYY-MM-DD strings, so everything is formatted in UTC to keep the calendar day exactly as
 *  entered — the guest's own timezone must never shift "Nov 3" to "Nov 2". */

const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** "Mon, Nov 3, 2026" */
export function formatStayDate(iso: string): string {
	return new Intl.DateTimeFormat('en-PH', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(parse(iso));
}

/** "Mon, Nov 3" — no year, for tight spaces. */
export function formatStayDateShort(iso: string): string {
	return new Intl.DateTimeFormat('en-PH', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC'
	}).format(parse(iso));
}

/** Whole nights between two dates (0 if the range is empty or backwards). */
export function stayNights(checkIn: string, checkOut: string): number {
	const n = Math.round((parse(checkOut).getTime() - parse(checkIn).getTime()) / 86_400_000);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

export const nightsLabel = (n: number) => `${n} night${n === 1 ? '' : 's'}`;

/** "14:00:00" → "2:00 PM". Returns the input untouched if it isn't HH:MM. */
export function formatClockTime(time: string): string {
	const m = /^(\d{1,2}):(\d{2})/.exec(time);
	if (!m) return time;
	const h = Number(m[1]);
	return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}
