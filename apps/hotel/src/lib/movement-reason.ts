/**
 * A plain-words reason for a cash movement, so Finance can see WHY money moved without reading
 * memos. Pure: it only looks at what the ledger already records (the movement's category and memo,
 * and the payment behind it). Older movements, written before the reasons existed, fall back to
 * their category rather than guess.
 */

export interface MovementReasonInput {
	category: string;
	memo: string | null;
	/** The `payments` row behind the movement, when there is one. */
	paymentPurpose: string | null;
	paymentProvider: string | null;
}

export type ReasonTone = 'in' | 'out' | 'info';
export interface MovementReason {
	label: string;
	tone: ReasonTone;
}

export function movementReason(m: MovementReasonInput): MovementReason | null {
	const memo = (m.memo ?? '').toLowerCase();
	const scPwd = memo.includes('sc/pwd');

	// A refund of a room's credit.
	if (m.paymentPurpose === 'refund' || m.category === 'refund') {
		if (scPwd) return { label: 'SC/PWD credit refund', tone: 'out' };
		return { label: 'Refund', tone: 'out' };
	}

	// Money in for a room / event booking, through a payment.
	if (m.paymentPurpose === 'deposit' || m.paymentPurpose === 'settlement') {
		if (m.paymentProvider === 'paymongo') {
			return m.paymentPurpose === 'deposit'
				? { label: 'Online downpayment', tone: 'in' }
				: { label: 'Online, paid in full', tone: 'in' };
		}
		if (m.paymentPurpose === 'deposit') return { label: scPwd ? 'Partial payment (after SC/PWD)' : 'Partial payment', tone: 'in' };
		if (memo.includes('balance after the online downpayment')) {
			return { label: scPwd ? 'Balance at desk (after SC/PWD)' : 'Balance at desk', tone: 'in' };
		}
		return { label: scPwd ? 'Paid at desk (after SC/PWD)' : 'Paid at desk', tone: 'in' };
	}
	return null;
}
