/** Clock-based suggestion for the per-hour late-checkout / early-check-in fees. Pure, no DB. */

const HALF_HOUR_MS = 30 * 60 * 1000;

/**
 * Whole half-hours from `fromMs` to `toMs`, rounded DOWN — the odd minutes past a half hour
 * go the guest's way (a 12:00 checkout left at 5:07 PM suggests 5h, not 5.5h). 0 when the
 * gap is under half an hour or negative (on time / not early), i.e. nothing to suggest.
 * Staff can always override the suggestion.
 */
export function suggestedExtensionHours(fromMs: number, toMs: number): number {
	if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
	const gap = toMs - fromMs;
	if (gap < HALF_HOUR_MS) return 0;
	return Math.floor(gap / HALF_HOUR_MS) / 2;
}
