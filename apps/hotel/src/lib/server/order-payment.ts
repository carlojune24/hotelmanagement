import { getOrderLedger } from './folio';

export interface OrderPaymentSummary {
	/** Net paid so far on the order (refunds already subtracted). */
	paidCentavos: number;
	/** Still to be paid at the hotel. */
	dueAtHotelCentavos: number;
}

/**
 * What the guest-facing pages and emails say about an order's payment. Returns `null` for an
 * ordinary pay-in-full order (every order made before downpayments existed included), so those
 * keep their existing "Total paid" wording untouched; only a downpayment order gets a summary.
 */
export async function getOrderPaymentSummary(order: {
	id: string;
	totalCentavos: number;
	amountDueNowCentavos: number | null;
	status: string;
}): Promise<OrderPaymentSummary | null> {
	if (order.amountDueNowCentavos == null) return null;
	// The booking's totals are the sum of its rooms: paid across the order, and what its rooms still owe.
	const ledger = await getOrderLedger(order.id);
	return {
		paidCentavos: ledger.paidTotalCentavos,
		dueAtHotelCentavos: order.status === 'confirmed' ? Math.max(0, ledger.balanceCentavos) : 0
	};
}
