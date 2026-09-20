/** Pure maths for a booking's parent-level ledger. An `orders` row is the parent of every room /
 *  hall line in a booking; the money is settled at that level — one balance for the whole
 *  booking, never a per-room share of a payment. Amounts are integer centavos. */

export interface LedgerLine {
	/** Sum of the line's non-voided folio charges, or `null` when it has no folio yet. */
	folioChargesCentavos: number | null;
	/** The line's own priced total (`bookings.totalCentavos` / `hallBookings.totalCentavos`). */
	totalCentavos: number;
	status: string;
}

/** Statuses in which a line is a real sale even before anyone has opened its folio. A
 *  `pending_payment` line isn't owed yet and a `cancelled` one owes only what its cancellation
 *  left on the folio (the retained fee) — both count zero when they have no folio. */
const LIVE_STATUSES = new Set(['confirmed', 'checked_in', 'checked_out', 'completed']);

export function lineChargesCentavos(line: LedgerLine): number {
	if (line.folioChargesCentavos != null) return line.folioChargesCentavos;
	return LIVE_STATUSES.has(line.status) ? line.totalCentavos : 0;
}

export interface OrderLedgerTotals {
	chargesTotalCentavos: number;
	/** Net paid on the order (refunds already subtracted). */
	paidTotalCentavos: number;
	/** Positive = still owed by the guest; negative = credit owed back to them. */
	balanceCentavos: number;
}

export function orderLedgerTotals(lines: LedgerLine[], paidCentavos: number): OrderLedgerTotals {
	const chargesTotalCentavos = lines.reduce((sum, l) => sum + lineChargesCentavos(l), 0);
	return {
		chargesTotalCentavos,
		paidTotalCentavos: paidCentavos,
		balanceCentavos: chargesTotalCentavos - paidCentavos
	};
}

/** What a cancellation refunds. `orderChargesCentavos` (C) and `orderPaidCentavos` (P) are the
 *  booking's totals before the cancel; the cancelled line's charge (L) is replaced by the fee it
 *  keeps (F), so the booking still owes C − L + F. The guest gets back only what they have paid
 *  beyond that; anything short of it stays as the booking's balance. */
export function cancellationRefundCentavos(args: {
	orderChargesCentavos: number;
	orderPaidCentavos: number;
	lineChargesCentavos: number;
	feeCentavos: number;
}): number {
	const owedAfter = args.orderChargesCentavos - args.lineChargesCentavos + args.feeCentavos;
	return Math.max(0, args.orderPaidCentavos - owedAfter);
}
