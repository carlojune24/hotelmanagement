/**
 * Overtime for a function-hall event that ran past its booked end time. Pure (no database, no
 * SvelteKit), so the check-out dialog's preview and the server's charge are the same arithmetic.
 *
 * The rule is **per started hour, no grace**: one minute past the end is one hour, an hour and a
 * minute is two. The rate is the hall's own `extraHourFeeCentavos`, the same rate that prices a
 * longer booking, with VAT added on top the way `priceEventHall` does for booked extra hours.
 */

const HOUR_MS = 3_600_000;

/** Whole started hours between the booked end and now; 0 when it ended on time or early. */
export function hallOvertimeHours(scheduledEndMs: number, nowMs: number): number {
	const overrun = nowMs - scheduledEndMs;
	return overrun > 0 ? Math.ceil(overrun / HOUR_MS) : 0;
}

export interface HallOvertime {
	hours: number;
	/** Hours times the hall's extra-hour fee, before VAT. */
	subtotalCentavos: number;
	vatCentavos: number;
	totalCentavos: number;
}

export function hallOvertimeAmount(hours: number, extraHourFeeCentavos: number, vatRateBps: number): HallOvertime {
	const subtotalCentavos = hours > 0 ? hours * extraHourFeeCentavos : 0;
	const vatCentavos = Math.round((subtotalCentavos * vatRateBps) / 10_000);
	return { hours, subtotalCentavos, vatCentavos, totalCentavos: subtotalCentavos + vatCentavos };
}
