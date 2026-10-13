import { shiftSpanMinutes } from './roster';

/** An overtime application never covers more than this, so a typo can't credit a day of overtime. */
export const MAX_OVERTIME_MINUTES = 12 * 60;

/** Length of a filed range (`end <= start` runs past midnight); 0 when the times are equal or unset. */
export function overtimeMinutes(start: string, end: string): number {
	return shiftSpanMinutes(start, end);
}

/** Error text for a range that can't be filed, or null. */
export function overtimeRangeError(start: string, end: string): string | null {
	const m = overtimeMinutes(start, end);
	if (m === 0) return 'Enter a start and end time that differ.';
	if (m > MAX_OVERTIME_MINUTES) return 'Overtime can’t be longer than 12 hours.';
	return null;
}

type Range = [fromMs: number, toMs: number];
const MS_PER_MIN = 60_000;

/** Whether two ranges share any time. */
export function rangesOverlap(a: Range, b: Range): boolean {
	return Math.max(a[0], b[0]) < Math.min(a[1], b[1]);
}

/**
 * Splits the overtime a person actually punched into the part an approved application
 * covers and the rest. `punched` is `[scheduled end, punch-out]`; `approved` are the
 * filed ranges (overlapping ones count once).
 */
export function creditOvertime(
	punched: Range,
	approved: Range[]
): { approvedMinutes: number; unapprovedMinutes: number } {
	const total = Math.max(0, Math.round((punched[1] - punched[0]) / MS_PER_MIN));
	const merged: Range[] = [];
	for (const r of [...approved].sort((a, b) => a[0] - b[0])) {
		const last = merged[merged.length - 1];
		if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
		else merged.push([r[0], r[1]]);
	}
	let covered = 0;
	for (const r of merged) {
		const lo = Math.max(r[0], punched[0]);
		const hi = Math.min(r[1], punched[1]);
		if (hi > lo) covered += Math.round((hi - lo) / MS_PER_MIN);
	}
	const approvedMinutes = Math.min(total, covered);
	return { approvedMinutes, unapprovedMinutes: total - approvedMinutes };
}
