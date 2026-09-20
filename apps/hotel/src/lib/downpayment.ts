/** Pure downpayment maths — no DB. The percentage lives on a cancellation policy
 *  (`cancellation_policies.downpayment_bps`); this file turns per-line percentages into what the
 *  guest pays online, and splits an order-level payment across the order's lines.
 *
 *  All amounts are integer centavos; percentages are basis points (5000 = 50%). */

export interface DownpaymentLine {
	totalCentavos: number;
	/** Null or 10000 = pay in full; halls have no policy, so they pass null. */
	downpaymentBps: number | null;
}

export interface DownpaymentSplit {
	dueNowCentavos: number;
	dueAtHotelCentavos: number;
}

/** True when a policy actually asks for less than the full amount up front. */
export function isPartialDownpayment(bps: number | null | undefined): bps is number {
	return bps != null && bps > 0 && bps < 10_000;
}

/** Each line's share is rounded to a whole centavo on its own, then summed — so the order's
 *  due-now figure always equals the sum of what its lines individually owe up front. A 0% policy
 *  is treated as pay-in-full: PayMongo can't confirm an order for ₱0, so 0 is never a valid ask. */
export function computeDownpayment(lines: DownpaymentLine[]): DownpaymentSplit {
	let due = 0;
	let total = 0;
	for (const l of lines) {
		total += l.totalCentavos;
		due += isPartialDownpayment(l.downpaymentBps)
			? Math.round((l.totalCentavos * l.downpaymentBps) / 10_000)
			: l.totalCentavos;
	}
	due = Math.min(Math.max(due, 0), total);
	return { dueNowCentavos: due, dueAtHotelCentavos: total - due };
}
