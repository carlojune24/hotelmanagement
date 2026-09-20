/** What happened to a cancelled room's refund, from the refund rows tagged to it. Pure, no DB. */

export type RefundState = 'refunded' | 'pending' | 'failed' | 'owed' | 'none';

export interface RefundRow {
	/** Negative, as stored (a refund reduces what the room has been paid). */
	amountCentavos: number;
	status: 'paid' | 'pending' | 'failed';
	method: string;
}

export interface RefundSummary {
	state: RefundState;
	refundedCentavos: number;
	pendingCentavos: number;
	failedCentavos: number;
	/** The room is still in credit — paid more than the fee it kept — and nothing has gone back yet. */
	owedCentavos: number;
}

/**
 * `balanceCentavos` is the cancelled room's own balance (charges kept − paid): negative means the
 * room is still in credit, i.e. money is owed back to the guest.
 * Precedence: a failed attempt or a still-pending one is what staff must act on, then money that
 * really went back, then a refund that is simply owed, else nothing to return.
 */
export function summariseRefund(rows: RefundRow[], balanceCentavos: number): RefundSummary {
	const sum = (s: RefundRow['status']) =>
		rows.filter((r) => r.status === s).reduce((t, r) => t + Math.abs(r.amountCentavos), 0);
	const refundedCentavos = sum('paid');
	const pendingCentavos = sum('pending');
	const failedCentavos = sum('failed');
	const owedCentavos = Math.max(0, -balanceCentavos);

	let state: RefundState = 'none';
	if (failedCentavos > 0 && refundedCentavos === 0 && pendingCentavos === 0) state = 'failed';
	else if (pendingCentavos > 0) state = 'pending';
	else if (refundedCentavos > 0) state = 'refunded';
	else if (owedCentavos > 0) state = 'owed';
	return { state, refundedCentavos, pendingCentavos, failedCentavos, owedCentavos };
}
